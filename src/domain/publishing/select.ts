import type { Reference } from '../reference/reference.js';
import type { FieldValue } from '../note/fields.js';
import type { Visibility } from '../note/note.js';
import { matchesGlob } from '../vault/glob.js';
import type { Publication } from './publication.js';

/*
 * Selection decides which candidate entries a publication actually emits. It runs on index data
 * only — never a file read — so the plan can be built without opening a single note.
 *
 * Two layers of exposure: the note layer (`visibility`) is absolute eligibility — `private`
 * (the default) means no publication may ever emit it; the publication layer (globs) only
 * chooses among the eligible. A glob can never admit a private note.
 */

export interface PublicationCandidate {
  readonly vault: string;
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly slug?: string;
  readonly type?: string;
  readonly visibility: Visibility;
  readonly tags: readonly string[];
  readonly dates: readonly string[];
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly version: string;
  readonly references: readonly Reference[];
}

export type ExclusionReason =
  | { readonly kind: 'vault' }
  | { readonly kind: 'private' }
  | { readonly kind: 'not-included' }
  | { readonly kind: 'excluded'; readonly by: string };

export interface ExcludedCandidate {
  readonly candidate: PublicationCandidate;
  readonly reason: ExclusionReason;
}

export interface Selection {
  readonly included: readonly PublicationCandidate[];
  readonly excluded: readonly ExcludedCandidate[];
}

/** Filters candidates in order: vault scope → visibility (absolute) → include → exclude. */
export const selectCandidates = (
  publication: Publication,
  candidates: readonly PublicationCandidate[],
  definingVault: string,
): Selection => {
  const vaults = publication.vaults ?? [definingVault];
  const included: PublicationCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  for (const candidate of candidates) {
    if (!vaults.includes(candidate.vault)) {
      excluded.push({ candidate, reason: { kind: 'vault' } });
    } else if (candidate.visibility !== 'public') {
      excluded.push({ candidate, reason: { kind: 'private' } });
    } else if (
      publication.include.length > 0 &&
      !publication.include.some((glob) => matchesGlob(glob, candidate.path))
    ) {
      excluded.push({ candidate, reason: { kind: 'not-included' } });
    } else {
      const by = publication.exclude.find((glob) => matchesGlob(glob, candidate.path));
      if (by !== undefined) excluded.push({ candidate, reason: { kind: 'excluded', by } });
      else included.push(candidate);
    }
  }
  return { included, excluded };
};
