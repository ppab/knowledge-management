import type { IdentityConfig } from '../identity/identity.js';
import type { AstroThemeSpec } from '../publishing/astro-theme.js';
import type { Publication } from '../publishing/publication.js';

declare const vaultIdBrand: unique symbol;
export type VaultId = string & { readonly [vaultIdBrand]: true };

export const asVaultId = (raw: string): VaultId => raw as VaultId;

/** The `.ofl` directory identifies a vault; everything the vault needs lives under it. */
export const VAULT_DIR = '.ofl';

export interface VaultConfig {
  readonly id: VaultId;
  readonly name: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly identity: IdentityConfig;
  readonly editor?: string;
  /** `push`: a snapshot also sends the branch to its remote; absent = record locally only. */
  readonly snapshot?: { readonly push: boolean };
  /** Enabled plugins by name with their raw settings (`{}` for a bare key); absent = none. */
  readonly plugins?: Readonly<Record<string, unknown>>;
  /** Named publications keyed by name; absent = none defined. */
  readonly publications?: Readonly<Record<string, Publication>>;
  /**
   * Astro themes the vault defines under `.ofl/astro-themes/`, keyed by name; absent = none.
   * Read alongside `config.yaml` but never written back into it.
   */
  readonly astroThemes?: Readonly<Record<string, AstroThemeSpec>>;
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
