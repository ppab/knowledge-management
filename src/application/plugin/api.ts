import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import { resolveWriteTarget, type Scope } from '../../domain/scope/scope.js';
import { bindDate } from '../calendar/bind-date.js';
import { captureEntry } from '../entries/capture-entry.js';
import { listEntries, type ScopedEntry } from '../entries/list-entries.js';
import { showEntry } from '../entries/show-entry.js';
import type { AppDeps } from '../ports.js';
import { linkReference } from '../references/link-reference.js';
import { withScope } from '../scope/session.js';
import { searchEntries } from '../search/search-entries.js';
import { insertSnippet } from '../snippets/insert-snippet.js';
import type { EnabledPlugin, PluginApi, PluginRegistry } from './plugin.js';
import { setFields } from './set-fields.js';

export interface PluginApiOptions {
  /** Picks the vault for `capture` when the plugin's scope has several and `in` is not given. */
  readonly cwd?: string;
}

/**
 * The only place a plugin gets hold of the application's use cases. Everything is scoped to
 * the vaults that enable the plugin, and every write is one of the existing mutations.
 */
export const createPluginApi = (
  deps: AppDeps,
  registry: PluginRegistry,
  enabled: EnabledPlugin,
  options: PluginApiOptions = {},
): PluginApi => {
  const scope: Scope = enabled.scope;
  const first = scope.members.find((m) => m.available);
  const settings = first ? enabled.settings.get(first.root) : undefined;
  const byField = (key: string, value?: string): Promise<Result<ScopedEntry[], AppError>> =>
    withScope(deps, scope, (session) =>
      ok(
        session.opened.flatMap(({ vault, index }) =>
          index.byField(key, value).map((entry) => ({ ...entry, vault: vault.config.name })),
        ),
      ),
    );
  return {
    scope,
    settings,
    clock: deps.clock,
    list: (filters) => listEntries(deps, scope, filters),
    byField,
    search: (query, searchOptions) => searchEntries(deps, scope, query, searchOptions),
    read: (query) => showEntry(deps, scope, query),
    capture: ({ in: inVault, ...input }) => {
      const target = resolveWriteTarget(scope, {
        ...(inVault !== undefined && { vault: inVault }),
        ...(options.cwd !== undefined && { cwd: options.cwd }),
      });
      if (!target.ok) return Promise.resolve(target);
      return captureEntry(deps, target.value, input, registry.templates());
    },
    setFields: (note, fields, mutation) =>
      setFields(deps, scope, { note, fields, ...(mutation?.dryRun !== undefined && mutation) }),
    bindDate: (input) => bindDate(deps, scope, input),
    linkReference: (input) => linkReference(deps, scope, input),
    insertSnippet: (input) => insertSnippet(deps, scope, input),
  };
};
