import { ambiguous, notFound, unavailable, type AppError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

/*
 * Resolving user input (an id, a title or an alias) to one note across a scope. Each vault
 * reports its own id matches and name matches; this merges them under invariants 3 and 4 and
 * decision A6 (a miss is `Unavailable` when any vault in the scope could not be opened).
 */

export interface VaultCandidates<T> {
  readonly vault: string;
  readonly byId: readonly T[];
  readonly byName: readonly T[];
}

export interface Located<T> {
  readonly vault: string;
  readonly note: T;
}

export type ResolutionResult<T> =
  | { readonly state: 'resolved'; readonly match: Located<T> }
  | { readonly state: 'ambiguous'; readonly by: 'id' | 'name'; readonly candidates: Located<T>[] }
  | { readonly state: 'unavailable'; readonly vaults: readonly string[] }
  | { readonly state: 'not-found' };

export const mergeResolution = <T>(
  perVault: readonly VaultCandidates<T>[],
  unavailableVaults: readonly string[],
): ResolutionResult<T> => {
  const byId = perVault.flatMap((v) => v.byId.map((note) => ({ vault: v.vault, note })));
  if (byId.length > 1) return { state: 'ambiguous', by: 'id', candidates: byId };
  const [idMatch] = byId;
  if (idMatch) return { state: 'resolved', match: idMatch };

  const byName = perVault.flatMap((v) => v.byName.map((note) => ({ vault: v.vault, note })));
  if (byName.length > 1) return { state: 'ambiguous', by: 'name', candidates: byName };
  const [nameMatch] = byName;
  if (nameMatch) return { state: 'resolved', match: nameMatch };

  if (unavailableVaults.length > 0) return { state: 'unavailable', vaults: unavailableVaults };
  return { state: 'not-found' };
};

/** Turns a non-resolved outcome into the error the interfaces map to exit codes 3, 4 and 7. */
export const resolutionError = <
  T extends { readonly id?: string; readonly title: string; readonly path: string },
>(
  query: string,
  result: Exclude<ResolutionResult<T>, { state: 'resolved' }>,
): AppError => {
  switch (result.state) {
    case 'ambiguous':
      return ambiguous(
        result.by === 'id'
          ? `Duplicate identity: ${String(result.candidates.length)} notes share id ${query}`
          : `"${query}" matches ${String(result.candidates.length)} notes`,
        {
          query,
          candidates: result.candidates.map((c) => ({
            vault: c.vault,
            ...(c.note.id !== undefined && { id: c.note.id }),
            title: c.note.title,
            path: c.note.path,
          })),
        },
      );
    case 'unavailable':
      return unavailable(
        `No note "${query}" in the available vaults; ${String(result.vaults.length)} vault(s) in the scope could not be opened`,
        { query, vaults: result.vaults },
      );
    case 'not-found':
      return notFound(`No note with id, title or alias "${query}"`, { query });
  }
};

export const resolved = <
  T extends { readonly id?: string; readonly title: string; readonly path: string },
>(
  query: string,
  result: ResolutionResult<T>,
): Result<Located<T>, AppError> =>
  result.state === 'resolved' ? ok(result.match) : err(resolutionError(query, result));
