import type { AppError } from '../../domain/errors.js';
import { formatReference } from '../../domain/reference/reference.js';
import type { Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { locateInsertion, type InsertionLocation } from '../../domain/text/insertion.js';
import { mutateNote, type MutationOutcome } from '../mutations/mutate.js';
import type { AppDeps } from '../ports.js';
import { readNoteInScope, resolveInScope, withScope } from '../scope/session.js';

export interface AddReferenceInput {
  /** Note to edit: id, title or alias. */
  readonly source: string;
  /** Note to point at, anywhere in the scope: id, title or alias; the canonical id is written. */
  readonly target: string;
  readonly at?: InsertionLocation;
  readonly label?: string;
  readonly dryRun?: boolean;
}

export const addReference = (
  deps: AppDeps,
  scope: Scope,
  input: AddReferenceInput,
): Promise<Result<MutationOutcome, AppError>> =>
  withScope(deps, scope, async (session) => {
    const target = resolveInScope(session, input.target);
    if (!target.ok) return target;
    const located = await readNoteInScope(deps, session, input.source);
    if (!located.ok) return located;
    const { vault, index, note } = located.value;
    const plan = locateInsertion(
      { source: note.source, bodyStart: note.body.start, headings: note.headings },
      input.at ?? { kind: 'end' },
      formatReference(target.value.summary.id, input.label),
    );
    if (!plan.ok) return plan;
    return mutateNote(
      deps,
      vault,
      index,
      note,
      [plan.value.edit],
      { referenceDelta: 1, addedHeadings: plan.value.addsHeadings, frontmatter: 'unchanged' },
      { dryRun: input.dryRun ?? false },
    );
  });
