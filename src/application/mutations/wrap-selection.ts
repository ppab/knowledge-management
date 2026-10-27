import type { AppError } from '../../domain/errors.js';
import { formatReference } from '../../domain/reference/reference.js';
import type { Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { wrapSelection } from '../../domain/text/selection.js';
import type { SourceRange } from '../../domain/text/text-edit.js';
import type { AppDeps } from '../ports.js';
import {
  readNoteInScope,
  resolveInScope,
  withScope,
  type LocatedNote,
  type ScopeSession,
} from '../scope/session.js';
import { mutateNote, type MutationOutcome } from './mutate.js';

/*
 * Selection-based wrapping, used by the TUI (M6). The selection is given in source offsets of
 * the note as last read; the note's `version` guards against the file having moved underneath.
 */

export interface WrapSelectionInput {
  readonly note: string;
  readonly selection: SourceRange;
  readonly dryRun?: boolean;
}

const wrapIn = (
  deps: AppDeps,
  located: LocatedNote,
  input: WrapSelectionInput,
  wrap: (text: string) => string,
  referenceDelta: number,
): Promise<Result<MutationOutcome, AppError>> => {
  const { vault, index, note } = located;
  const parsed = deps.markdown.parse(note.source, note.body.start);
  const edit = wrapSelection(
    { source: note.source, textSpans: parsed.textSpans, headings: note.headings },
    input.selection,
    wrap,
  );
  if (!edit.ok) return Promise.resolve(edit);
  return mutateNote(
    deps,
    vault,
    index,
    note,
    [edit.value],
    { referenceDelta, frontmatter: 'unchanged' },
    { dryRun: input.dryRun ?? false },
  );
};

const locate = (deps: AppDeps, session: ScopeSession, input: WrapSelectionInput) =>
  readNoteInScope(deps, session, input.note);

export const wrapSelectionAsReference = (
  deps: AppDeps,
  scope: Scope,
  input: WrapSelectionInput & { readonly target: string },
): Promise<Result<MutationOutcome, AppError>> =>
  withScope(deps, scope, async (session) => {
    const target = resolveInScope(session, input.target);
    if (!target.ok) return target;
    const located = await locate(deps, session, input);
    if (!located.ok) return located;
    const id = target.value.summary.id;
    return wrapIn(deps, located.value, input, (text) => formatReference(id, text), 1);
  });

export const wrapSelectionAsExternalLink = (
  deps: AppDeps,
  scope: Scope,
  input: WrapSelectionInput & { readonly url: string },
): Promise<Result<MutationOutcome, AppError>> =>
  withScope(deps, scope, async (session) => {
    const located = await locate(deps, session, input);
    if (!located.ok) return located;
    return wrapIn(deps, located.value, input, (text) => `[${text}](${input.url})`, 0);
  });
