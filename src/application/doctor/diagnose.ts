import type { AppError } from '../../domain/errors.js';
import { findDuplicateIds } from '../../domain/note/duplicates.js';
import { ok, type Result } from '../../domain/result.js';
import { applyPlan, isStale, planRefresh, staleOf } from '../index/refresh-index.js';
import type { AppDeps } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';

export type Severity = 'error' | 'warning' | 'info';

export type FindingKind = 'duplicate-id' | 'dangling-reference' | 'unidentified' | 'stale-index';

export interface Finding {
  readonly kind: FindingKind;
  readonly severity: Severity;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface Diagnosis {
  /** False when any finding is an error. */
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

/**
 * Checks the vault's integrity. The index is refreshed first so every check sees current
 * files; whether it was stale is itself reported.
 */
export const diagnose = async (
  deps: AppDeps,
  vault: VaultHandle,
): Promise<Result<Diagnosis, AppError>> => {
  const opened = await deps.indexes.open(vault.root);
  if (!opened.ok) return opened;
  const index = opened.value;
  try {
    const findings: Finding[] = [];

    const indexed = new Set(index.files().map((f) => f.path));
    const plan = await planRefresh(deps, vault, index);
    if (!plan.ok) return plan;
    const stale = staleOf(plan.value, indexed);
    // An empty index (first run, or a deleted cache) is new, not stale.
    if (indexed.size > 0 && isStale(stale)) {
      const count = stale.added.length + stale.modified.length + stale.removed.length;
      findings.push({
        kind: 'stale-index',
        severity: 'info',
        message: `Index was ${String(count)} file(s) behind and has been refreshed`,
        details: { ...stale },
      });
    }
    applyPlan(index, plan.value);

    const entries = index.all();
    for (const duplicate of findDuplicateIds(
      entries.map((e) => (e.kind === 'note' ? { id: e.id, path: e.path } : { path: e.path })),
    )) {
      findings.push({
        kind: 'duplicate-id',
        severity: 'error',
        message: `Id ${duplicate.id} is used by ${String(duplicate.paths.length)} files: ${duplicate.paths.join(', ')}`,
        details: { ...duplicate },
      });
    }
    for (const ref of index.dangling()) {
      findings.push({
        kind: 'dangling-reference',
        severity: 'warning',
        message: `${ref.sourcePath} references [[${ref.target}]], which does not exist`,
        details: { ...ref },
      });
    }
    for (const entry of entries) {
      if (entry.kind !== 'unidentified') continue;
      findings.push({
        kind: 'unidentified',
        severity: 'info',
        message:
          entry.issues.length > 0
            ? `${entry.path} has no valid id (${entry.issues.join('; ')})`
            : `${entry.path} has no id; run "notes adopt ${entry.path}"`,
        details: { path: entry.path, issues: entry.issues },
      });
    }

    return ok({ ok: !findings.some((f) => f.severity === 'error'), findings });
  } finally {
    index.close();
  }
};
