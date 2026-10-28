import { validation, type AppError } from '../../domain/errors.js';
import type { Note } from '../../domain/note/note.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { replaceRange, type SourceRange, type TextEdit } from '../../domain/text/text-edit.js';
import { checkVersion, mutateNote, type MutationOutcome } from '../mutations/mutate.js';
import type { AppDeps } from '../ports.js';
import { readNoteInScope, withScope } from '../scope/session.js';

export interface RemoveReferenceInput {
  /** Note to edit: id, title or alias. */
  readonly source: string;
  /** The exact `[[...]]` span, as `listReferences`/`viewNote` report it. */
  readonly range: SourceRange;
  readonly expectedVersion?: string;
  readonly dryRun?: boolean;
}

export type RemovalKind =
  /** `[[id|Label]]` became `Label`: the prose keeps reading the same. */
  | 'unlinked'
  /** `[[id]]` is gone with one adjacent space, or its whole line when it stood alone. */
  | 'deleted';

export interface RemoveReferencePlan {
  readonly kind: RemovalKind;
  readonly edit: TextEdit;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+$/;

/**
 * What removing a reference does to the text, computed on the source alone so the TUI and a
 * test can see it. A labelled reference leaves its label; a bare one takes one neighbouring
 * space with it (the following one when there is one, else the preceding), and when it was
 * the only thing on a list line, the whole line goes, so a `## References` list stays tidy.
 */
export const planRemoval = (
  note: Note,
  range: SourceRange,
): Result<RemoveReferencePlan, AppError> => {
  const reference = note.references.find(
    (r) => r.range.start === range.start && r.range.end === range.end,
  );
  if (!reference) {
    return err(
      validation('No reference at that position; the note may have changed', {
        path: note.path,
        range,
      }),
    );
  }
  if (reference.label !== undefined && reference.label !== '') {
    return ok({ kind: 'unlinked', edit: replaceRange(range, reference.label) });
  }
  const source = note.source;
  const lineStart = source.lastIndexOf('\n', range.start - 1) + 1;
  const lineEndIndex = source.indexOf('\n', range.end);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const rest = source.slice(lineStart, range.start) + source.slice(range.end, lineEnd);
  if (rest.trim() === '' || LIST_ITEM.test(rest)) {
    // Alone on its line (possibly behind a list marker): drop the line and its newline.
    const end = lineEndIndex === -1 ? lineEnd : lineEnd + 1;
    return ok({ kind: 'deleted', edit: replaceRange({ start: lineStart, end }, '') });
  }
  if (source[range.end] === ' ') {
    return ok({
      kind: 'deleted',
      edit: replaceRange({ start: range.start, end: range.end + 1 }, ''),
    });
  }
  if (range.start > lineStart && source[range.start - 1] === ' ') {
    return ok({
      kind: 'deleted',
      edit: replaceRange({ start: range.start - 1, end: range.end }, ''),
    });
  }
  return ok({ kind: 'deleted', edit: replaceRange(range, '') });
};

export interface RemovedReference extends MutationOutcome {
  readonly kind: RemovalKind;
}

export const removeReference = (
  deps: AppDeps,
  scope: Scope,
  input: RemoveReferenceInput,
): Promise<Result<RemovedReference, AppError>> =>
  withScope(deps, scope, async (session) => {
    const located = await readNoteInScope(deps, session, input.source);
    if (!located.ok) return located;
    const { vault, index, note } = located.value;
    const fresh = checkVersion(note, input.expectedVersion);
    if (!fresh.ok) return fresh;
    const plan = planRemoval(note, input.range);
    if (!plan.ok) return plan;
    const outcome = await mutateNote(
      deps,
      vault,
      index,
      note,
      [plan.value.edit],
      { referenceDelta: -1, frontmatter: 'unchanged' },
      { dryRun: input.dryRun ?? false },
    );
    if (!outcome.ok) return outcome;
    return ok({ ...outcome.value, kind: plan.value.kind });
  });
