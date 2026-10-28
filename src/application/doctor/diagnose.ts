import type { AppError } from '../../domain/errors.js';
import { findDuplicateIds } from '../../domain/note/duplicates.js';
import { ok, type Result } from '../../domain/result.js';
import { availableVaults, type Scope } from '../../domain/scope/scope.js';
import { applyPlan, isStale, planRefresh, staleOf } from '../index/refresh-index.js';
import { createPluginApi } from '../plugin/api.js';
import type { PluginRegistry } from '../plugin/plugin.js';
import { validateFields } from '../plugin/validate-fields.js';
import type { AppDeps } from '../ports.js';
import type { OpenedVault } from '../scope/session.js';

export type Severity = 'error' | 'warning' | 'info';

export type CoreFindingKind =
  | 'duplicate-id'
  | 'dangling-reference'
  | 'unidentified'
  | 'stale-index'
  | 'unavailable-vault'
  | 'field';

/** Core kinds, or a plugin check's kind namespaced as `<plugin>:<kind>`. */
export type FindingKind = CoreFindingKind | `${string}:${string}`;

export interface Finding {
  readonly kind: FindingKind;
  readonly severity: Severity;
  /** The vault's name, or its root when it could not be opened. */
  readonly vault: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface Diagnosis {
  /** False when any finding is an error. */
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

/** Notes of an owned type are checked against the owner's field specs (docs/plugins.md §2). */
const fieldFindings = (registry: PluginRegistry, opened: readonly OpenedVault[]): Finding[] => {
  const findings: Finding[] = [];
  for (const { vault, index } of opened) {
    for (const entry of index.all()) {
      if (entry.type === undefined) continue;
      const owner = registry.ownerOf(entry.type);
      if (!owner) continue;
      const enabledHere = registry.enabled.some(
        (e) => e.plugin === owner && e.scope.members.some((m) => m.root === vault.root),
      );
      if (!enabledHere) continue;
      for (const issue of validateFields(registry.fieldsFor(entry.type), entry.fields)) {
        findings.push({
          kind: 'field',
          severity: issue.problem === 'undeclared' ? 'info' : 'warning',
          vault: vault.config.name,
          message: `${entry.path} (${entry.type}): ${issue.message}`,
          details: {
            path: entry.path,
            type: entry.type,
            plugin: owner.name,
            field: issue.field,
            problem: issue.problem,
            ...(issue.allowed && { allowed: issue.allowed }),
          },
        });
      }
    }
  }
  return findings;
};

const pluginFindings = async (
  deps: AppDeps,
  registry: PluginRegistry,
): Promise<Result<Finding[], AppError>> => {
  const findings: Finding[] = [];
  for (const enabled of registry.enabled) {
    const api = createPluginApi(deps, registry, enabled);
    for (const check of enabled.plugin.checks ?? []) {
      const results = await check.run(api);
      if (!results.ok) return results;
      for (const result of results.value) {
        findings.push({
          kind: `${enabled.plugin.name}:${check.kind}`,
          severity: result.severity,
          vault: result.vault,
          message: result.message,
          details: { path: result.path, ...result.details },
        });
      }
    }
  }
  return ok(findings);
};

/**
 * Checks every vault in the scope. Indexes are refreshed first so the checks see current
 * files; whether an index was stale is itself reported. A reference that dangles in its own
 * vault but resolves in another vault of the scope is not dangling. With a registry, notes of
 * owned types are validated against their declared fields and every enabled plugin's checks
 * run after the core's.
 */
export const diagnose = async (
  deps: AppDeps,
  scope: Scope,
  registry?: PluginRegistry,
): Promise<Result<Diagnosis, AppError>> => {
  const core = await diagnoseCore(deps, scope, registry);
  if (!core.ok || !registry) return core;
  const plugins = await pluginFindings(deps, registry);
  if (!plugins.ok) return plugins;
  const findings = [...core.value.findings, ...plugins.value];
  return ok({ ok: !findings.some((f) => f.severity === 'error'), findings });
};

const diagnoseCore = async (
  deps: AppDeps,
  scope: Scope,
  registry: PluginRegistry | undefined,
): Promise<Result<Diagnosis, AppError>> => {
  const findings: Finding[] = [];
  const opened: OpenedVault[] = [];
  try {
    for (const member of scope.members) {
      if (!member.available) {
        findings.push({
          kind: 'unavailable-vault',
          severity: 'error',
          vault: member.root,
          message: `Vault ${member.root} is unavailable: ${member.reason}`,
          details: { root: member.root, reason: member.reason },
        });
      }
    }
    for (const vault of availableVaults(scope)) {
      const index = await deps.indexes.open(vault.root);
      if (!index.ok) return index;
      opened.push({ vault, index: index.value });

      const indexed = new Set(index.value.files().map((f) => f.path));
      const plan = await planRefresh(deps, vault, index.value);
      if (!plan.ok) return plan;
      const stale = staleOf(plan.value, indexed);
      // An empty index (first run, or a deleted cache) is new, not stale.
      if (indexed.size > 0 && isStale(stale)) {
        const count = stale.added.length + stale.modified.length + stale.removed.length;
        findings.push({
          kind: 'stale-index',
          severity: 'info',
          vault: vault.config.name,
          message: `Index was ${String(count)} file(s) behind and has been refreshed`,
          details: { ...stale },
        });
      }
      applyPlan(index.value, plan.value);
    }

    const existsInScope = (id: string): boolean =>
      opened.some(({ index }) => index.byId(id).length > 0);

    for (const { vault, index } of opened) {
      const name = vault.config.name;
      const entries = index.all();
      for (const duplicate of findDuplicateIds(
        entries.map((e) => (e.kind === 'note' ? { id: e.id, path: e.path } : { path: e.path })),
      )) {
        findings.push({
          kind: 'duplicate-id',
          severity: 'error',
          vault: name,
          message: `Id ${duplicate.id} is used by ${String(duplicate.paths.length)} files: ${duplicate.paths.join(', ')}`,
          details: { ...duplicate },
        });
      }
      for (const ref of index.dangling()) {
        if (existsInScope(ref.target)) continue;
        findings.push({
          kind: 'dangling-reference',
          severity: 'warning',
          vault: name,
          message: `${ref.sourcePath} references [[${ref.target}]], which does not exist`,
          details: { ...ref },
        });
      }
      for (const entry of entries) {
        if (entry.kind !== 'unidentified') continue;
        findings.push({
          kind: 'unidentified',
          severity: 'info',
          vault: name,
          message:
            entry.issues.length > 0
              ? `${entry.path} has no valid id (${entry.issues.join('; ')})`
              : `${entry.path} has no id; run "notes adopt ${entry.path}"`,
          details: { path: entry.path, issues: entry.issues },
        });
      }
    }
    // Across the scope, an id owned by several vaults cannot be resolved by id (invariant 3).
    if (opened.length > 1) {
      const owners = new Map<string, { vault: string; path: string }[]>();
      for (const { vault, index } of opened) {
        for (const entry of index.all()) {
          if (entry.kind !== 'note') continue;
          const list = owners.get(entry.id) ?? [];
          list.push({ vault: vault.config.name, path: entry.path });
          owners.set(entry.id, list);
        }
      }
      for (const [id, list] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
        const vaults = new Set(list.map((o) => o.vault));
        if (vaults.size < 2) continue;
        findings.push({
          kind: 'duplicate-id',
          severity: 'warning',
          vault: 'scope',
          message: `Id ${id} exists in ${String(vaults.size)} vaults: ${list.map((o) => `${o.vault} (${o.path})`).join(', ')}`,
          details: { id, owners: list },
        });
      }
    }
    if (registry) findings.push(...fieldFindings(registry, opened));
    return ok({ ok: !findings.some((f) => f.severity === 'error'), findings });
  } finally {
    for (const { index } of opened) index.close();
  }
};
