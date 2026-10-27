import { notFound, validation, type AppError } from '../../domain/errors.js';
import { validateIdentityConfig, type IdentityConfig } from '../../domain/identity/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  asVaultId,
  defaultVaultConfig,
  VAULT_DIR,
  type VaultConfig,
} from '../../domain/vault/vault.js';
import type { AppDeps } from '../ports.js';

/** An opened vault: its absolute root plus validated configuration. */
export interface VaultHandle {
  readonly root: string;
  readonly config: VaultConfig;
}

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
