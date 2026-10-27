import { ambiguous, notFound, type AppError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

/*
 * A revision is a recorded historical state of one note. Git is the first provider, but
 * nothing here is Git-specific: ids are opaque strings, and where the file lived at the time
 * is whatever the provider needs to read it back.
 */

export interface Revision {
  /** Opaque provider id; `abbreviate` shortens it for display. */
  readonly id: string;
  /** ISO 8601 timestamp of the revision. */
  readonly timestamp: string;
  readonly summary: string;
  readonly author?: string;
  /** The note's path at that revision, as the provider addresses it. */
  readonly path: string;
}

/** How the working file relates to its revisions. */
export type RevisionStatus =
  /** No revision provider holds the vault (e.g. no Git repository above it). */
  | { readonly kind: 'unversioned' }
  /** Versioned, but no revision of this file has been recorded yet. */
  | { readonly kind: 'unrecorded' }
  | { readonly kind: 'clean'; readonly last: Revision }
  | { readonly kind: 'modified'; readonly last: Revision };

/** Whether `save` has something to record. */
export const isUnsaved = (status: RevisionStatus): boolean =>
  status.kind === 'modified' || status.kind === 'unrecorded';

export const ABBREVIATED_LENGTH = 7;

export const abbreviate = (id: string): string => id.slice(0, ABBREVIATED_LENGTH);

/** A revision by full id or unique prefix, among `revisions` (newest first). */
export const findRevision = (
  revisions: readonly Revision[],
  query: string,
): Result<Revision, AppError> => {
  const exact = revisions.find((r) => r.id === query);
  if (exact) return ok(exact);
  const matches = query.length >= 4 ? revisions.filter((r) => r.id.startsWith(query)) : [];
  const [first, second] = matches;
  if (second) {
    return err(
      ambiguous(`Revision "${query}" matches ${String(matches.length)} revisions`, {
        query,
        candidates: matches.map((r) => r.id),
      }),
    );
  }
  if (first) return ok(first);
  return err(notFound(`No revision "${query}" of this note`, { query }));
};

/** The revision recorded just before `revision`, if any. */
export const previousRevision = (
  revisions: readonly Revision[],
  revision: Revision,
): Revision | undefined => {
  const index = revisions.findIndex((r) => r.id === revision.id);
  return index < 0 ? undefined : revisions[index + 1];
};
