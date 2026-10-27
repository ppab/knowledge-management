import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { AppDeps } from '../ports.js';

export interface ScopeListing {
  readonly configPath: string;
  readonly scopes: readonly { readonly name: string; readonly vaults: readonly string[] }[];
}

/** The named scopes the user has configured; what `--scope` accepts. */
export const listScopes = async (deps: AppDeps): Promise<Result<ScopeListing, AppError>> => {
  const config = await deps.userConfig.load();
  if (!config.ok) return config;
  return ok({
    configPath: deps.userConfig.path(),
    scopes: Object.entries(config.value.scopes)
      .map(([name, definition]) => ({ name, vaults: definition.vaults }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
};

export interface ScopeDescription {
  readonly name?: string;
  readonly members: readonly {
    readonly root: string;
    readonly available: boolean;
    readonly name?: string;
    readonly id?: string;
    readonly reason?: string;
  }[];
}

export const describeScope = (scope: Scope): ScopeDescription => ({
  ...(scope.name !== undefined && { name: scope.name }),
  members: scope.members.map((m) =>
    m.available
      ? { root: m.root, available: true, name: m.vault.config.name, id: m.vault.config.id }
      : { root: m.root, available: false, reason: m.reason },
  ),
});
