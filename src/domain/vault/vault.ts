import type { IdentityConfig } from '../identity/identity.js';

declare const vaultIdBrand: unique symbol;
export type VaultId = string & { readonly [vaultIdBrand]: true };

export const asVaultId = (raw: string): VaultId => raw as VaultId;

/** The `.notes` directory identifies a vault; everything the vault needs lives under it. */
export const VAULT_DIR = '.notes';

export interface VaultConfig {
  readonly id: VaultId;
  readonly name: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly identity: IdentityConfig;
  readonly editor?: string;
}

/** A vault that has been located and whose configuration validated. */
export interface OpenVault {
  readonly root: string;
  readonly config: VaultConfig;
}

export const defaultVaultConfig = (id: VaultId, name: string): VaultConfig => ({
  id,
  name,
  include: ['**/*.md'],
  exclude: ['node_modules/**', '.git/**'],
  identity: { strategy: 'ulid' },
});

/**
 * The literal directory prefix of a glob — `docs/**\/*.md` → `docs`, `**\/*.md` → `` — used
 * as the default location for new notes.
 */
export const globStaticPrefix = (glob: string): string => {
  const segments: string[] = [];
  for (const segment of glob.split('/')) {
    if (/[*?[\]{}]/.test(segment)) break;
    segments.push(segment);
  }
  if (segments.length === glob.split('/').length) segments.pop(); // a literal file, not a directory
  return segments.join('/');
};
