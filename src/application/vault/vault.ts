import { notFound, usage, validation, type AppError } from '../../domain/errors.js';
import { validateIdentityConfig, type IdentityConfig } from '../../domain/identity/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope, ScopeMember } from '../../domain/scope/scope.js';
import {
  asVaultId,
  defaultVaultConfig,
  VAULT_DIR,
  type OpenVault,
  type VaultConfig,
} from '../../domain/vault/vault.js';
import type { AppDeps } from '../ports.js';

/** An opened vault: its absolute root plus validated configuration. */
export type VaultHandle = OpenVault;

export interface InitVaultInput {
  readonly dir: string;
  readonly name?: string;
  readonly identity?: IdentityConfig;
}

const lastSegment = (dir: string): string =>
  dir
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? 'vault';

export const initVault = async (
  deps: AppDeps,
  input: InitVaultInput,
): Promise<Result<VaultHandle, AppError>> => {
  if (await deps.vaults.exists(input.dir)) {
    return err(validation(`${input.dir} is already a vault (${VAULT_DIR}/ exists)`));
  }
  const identity = input.identity ?? { strategy: 'ulid' };
  const valid = validateIdentityConfig(identity);
  if (!valid.ok) return valid;

  const config: VaultConfig = {
    ...defaultVaultConfig(asVaultId(deps.unique.ulid()), input.name ?? lastSegment(input.dir)),
    identity,
  };
  const created = await deps.vaults.create(input.dir, config);
  if (!created.ok) return created;
  return ok({ root: input.dir, config });
};

export interface OpenVaultInput {
  readonly cwd: string;
  /** Explicit vault root; skips ancestor discovery. */
  readonly root?: string;
}

export const openVault = async (
  deps: AppDeps,
  input: OpenVaultInput,
): Promise<Result<VaultHandle, AppError>> => {
  let root: string;
  if (input.root !== undefined) {
    if (!(await deps.vaults.exists(input.root))) {
      return err(notFound(`No vault at ${input.root} (missing ${VAULT_DIR}/config.yaml)`));
    }
    root = input.root;
  } else {
    const nearest = await deps.vaults.findNearest(input.cwd);
    if (nearest === null) {
      return err(
        notFound(`No vault found: no ${VAULT_DIR}/ directory in ${input.cwd} or its ancestors`),
      );
    }
    root = nearest;
  }
  const config = await deps.vaults.load(root);
  if (!config.ok) return config;
  return ok({ root, config: config.value });
};

export interface LoadScopeInput {
  readonly cwd: string;
  /** A named scope from the user config. */
  readonly scope?: string;
  /** Explicit vault roots (`--vault`, repeatable); one root is a single-vault scope. */
  readonly vaults?: readonly string[];
}

const openMember = async (deps: AppDeps, root: string): Promise<ScopeMember> => {
  if (!(await deps.vaults.exists(root))) {
    return { available: false, root, reason: `no ${VAULT_DIR}/config.yaml` };
  }
  const config = await deps.vaults.load(root);
  return config.ok
    ? { available: true, root, vault: { root, config: config.value } }
    : { available: false, root, reason: config.error.message };
};

/**
 * Scope resolution order: explicit `--vault` roots, then a named scope, then the nearest vault
 * from `cwd`. Members that cannot be opened stay in the scope as unavailable (decision A11), so
 * reads of the other members keep working and misses can be reported honestly (A6).
 */
export const loadScope = async (
  deps: AppDeps,
  input: LoadScopeInput,
): Promise<Result<Scope, AppError>> => {
  const roots = input.vaults ?? [];
  if (roots.length > 0 && input.scope !== undefined) {
    return err(usage('Pass either --scope or --vault, not both'));
  }
  if (roots.length > 0) {
    return ok({ members: await Promise.all(roots.map((root) => openMember(deps, root))) });
  }
  if (input.scope !== undefined) {
    const config = await deps.userConfig.load();
    if (!config.ok) return config;
    const definition = config.value.scopes[input.scope];
    if (!definition) {
      return err(
        notFound(`No scope "${input.scope}" in ${deps.userConfig.path()}`, {
          scopes: Object.keys(config.value.scopes),
        }),
      );
    }
    return ok({
      name: input.scope,
      members: await Promise.all(definition.vaults.map((root) => openMember(deps, root))),
    });
  }
  const nearest = await openVault(deps, { cwd: input.cwd });
  if (!nearest.ok) return nearest;
  return ok({ members: [{ available: true, root: nearest.value.root, vault: nearest.value }] });
};
