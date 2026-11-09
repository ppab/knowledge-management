import type { SourceRange } from '../text/text-edit.js';
import type { ReferencePolicy } from './publication.js';
import type { PublicationCandidate } from './select.js';

/*
 * Every reference in an emitted entry is one of three states. `published` points at another
 * emitted entry (becomes a real link); `excluded` points at a note that exists but is not in this
 * publication; `unresolved` points at an id no note has. Under the `fail` policy, every non-
 * published reference is a violation that aborts the publication.
 */

export type ReferenceState = 'published' | 'excluded' | 'unresolved';

export interface Violation {
  readonly source: { readonly vault: string; readonly path: string; readonly id: string };
  readonly target: string;
  readonly state: Exclude<ReferenceState, 'published'>;
  readonly range: SourceRange;
}

export interface ReferenceTarget {
  readonly state: ReferenceState;
  /** The target's current title, for a reference whose label falls back to it; absent if unresolved. */
  readonly title?: string;
}

export interface Classification {
  readonly targets: ReadonlyMap<string, ReferenceTarget>;
  readonly violations: readonly Violation[];
}

/**
 * Classifies every reference across the emitted entries. `existing` is the title of every note in
 * scope (identified or not selected), used to tell an excluded target from an unresolved one and
 * to supply a label fallback.
 */
export const classifyReferences = (
  included: readonly PublicationCandidate[],
  existing: ReadonlyMap<string, { readonly title: string }>,
  policy: ReferencePolicy,
): Classification => {
  const published = new Set(included.map((candidate) => candidate.id));
  const targets = new Map<string, ReferenceTarget>();
  const violations: Violation[] = [];
  for (const note of included) {
    for (const reference of note.references) {
      const target = reference.target as string;
      const title = existing.get(target)?.title;
      const state: ReferenceState = published.has(target)
        ? 'published'
        : existing.has(target)
          ? 'excluded'
          : 'unresolved';
      if (!targets.has(target))
        targets.set(target, title !== undefined ? { state, title } : { state });
      if (policy === 'fail' && state !== 'published') {
        violations.push({
          source: { vault: note.vault, path: note.path, id: note.id },
          target,
          state,
          range: reference.range,
        });
      }
    }
  }
  return { targets, violations };
};
