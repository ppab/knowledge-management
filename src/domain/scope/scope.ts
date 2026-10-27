import { unavailable, usage, type AppError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import type { OpenVault } from '../vault/vault.js';

/*
 * A scope is the set of vaults a command operates on: one vault (the nearest, or an explicit
 * path) or a composite of several (a named scope from the user config, or several `--vault`
 * paths). Each member is either open or unavailable; reads carry on with what is open and say
 * so, writes always go to exactly one vault.
 */

export type ScopeMember =
  | { readonly available: true; readonly root: string; readonly vault: OpenVault }
  | { readonly available: false; readonly root: string; readonly reason: string };

export interface Scope {
  /** Set when the scope came from the user config. */
  readonly name?: string;
  readonly members: readonly ScopeMember[];
}

export const isComposite = (scope: Scope): boolean => scope.members.length > 1;

export const availableVaults = (scope: Scope): OpenVault[] =>
  scope.members.flatMap((m) => (m.available ? [m.vault] : []));

export const unavailableRoots = (scope: Scope): string[] =>
  scope.members.flatMap((m) => (m.available ? [] : [m.root]));

/** Member display name: the vault's configured name, or its path when it could not be opened. */
export const memberName = (member: ScopeMember): string =>
  member.available ? member.vault.config.name : member.root;

const isInside = (root: string, cwd: string): boolean =>
  cwd === root || cwd.startsWith(root.endsWith('/') ? root : `${root}/`);

export interface WriteTargetSelector {
  /** A member's name or root, as given by `--in`. */
  readonly vault?: string;
  /** Picks the member that contains it when nothing was named. */
  readonly cwd?: string;
}

/**
 * Invariant 7: a composite scope is read-only. A write needs exactly one vault: the only
 * member, the one named by the caller, or the one the working directory is inside of.
 */
export const resolveWriteTarget = (
  scope: Scope,
  selector: WriteTargetSelector = {},
): Result<OpenVault, AppError> => {
  const open = availableVaults(scope);
  if (selector.vault !== undefined) {
    const wanted = selector.vault;
    const named = open.filter((v) => v.config.name === wanted || v.root === wanted);
    const [first, second] = named;
    if (second) {
      return err(
        usage(`"${wanted}" names ${String(named.length)} vaults in this scope; use its path`, {
          candidates: named.map((v) => v.root),
        }),
      );
    }
    if (first) return ok(first);
    const [missing] = scope.members.flatMap((m) => (!m.available && m.root === wanted ? [m] : []));
    return missing
      ? err(unavailable(`Vault ${wanted} is unavailable: ${missing.reason}`, { root: wanted }))
      : err(
          usage(`No vault "${wanted}" in this scope`, {
            vaults: scope.members.map(memberName),
          }),
        );
  }
  const [only] = scope.members;
  if (only && scope.members.length === 1 && !only.available) {
    return err(
      unavailable(`Vault ${only.root} is unavailable: ${only.reason}`, { root: only.root }),
    );
  }
  const [single, more] = open;
  if (single && !more) return ok(single);
  if (selector.cwd !== undefined) {
    const cwd = selector.cwd;
    const containing = open
      .filter((v) => isInside(v.root, cwd))
      .sort((a, b) => b.root.length - a.root.length);
    const [innermost] = containing;
    if (innermost) return ok(innermost);
  }
  if (open.length === 0) {
    return err(
      unavailable('No vault in this scope is available', { roots: unavailableRoots(scope) }),
    );
  }
  return err(
    usage('This scope spans several vaults; pass --in <vault> to choose where to write', {
      vaults: open.map((v) => v.config.name),
    }),
  );
};
