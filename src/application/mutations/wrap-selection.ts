import type { AppError } from '../../domain/errors.js';
import { formatReference } from '../../domain/reference/reference.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { wrapSelection } from '../../domain/text/selection.js';
import type { SourceRange, TextEdit } from '../../domain/text/text-edit.js';
import type { AppDeps } from '../ports.js';
import {
  readNoteInScope,
  resolveInScope,
  withScope,
  type LocatedNote,
  type ScopeSession,
} from '../scope/session.js';
import { checkVersion, mutateNote, type MutationOutcome } from './mutate.js';

/*
 * Selection-based wrapping, used by the TUI (M6). The selection is given in source offsets of
 * the note as last read; `expectedVersion` is that read's version, so a file that changed
 * while the user was selecting is refused with a conflict instead of edited at stale offsets.
 */

export interface WrapSelectionInput {
  readonly note: string;
  readonly selection: SourceRange;
  /** Version of the note the selection was made on; a different one on disk is a conflict. */
  readonly expectedVersion?: string;
  readonly dryRun?: boolean;
}

/** The note is still the one selected on, and the selection is wrappable (single-text-node rule). */
const planWrap = (
  deps: AppDeps,
  located: LocatedNote,
  input: WrapSelectionInput,
  wrap: (text: string) => string,
): Result<TextEdit, AppError> => {
  const { note } = located;
  const fresh = checkVersion(note, input.expectedVersion);
  if (!fresh.ok) return fresh;
  const parsed = deps.markdown.parse(note.source, note.body.start);
  return wrapSelection(
    { source: note.source, textSpans: parsed.textSpans, headings: note.headings },
    input.selection,
    wrap,
  );
};

const wrapIn = (
  deps: AppDeps,
  located: LocatedNote,
  input: WrapSelectionInput,
  wrap: (text: string) => string,
  referenceDelta: number,
): Promise<Result<MutationOutcome, AppError>> => {
  const { vault, index, note } = located;
  const edit = planWrap(deps, located, input, wrap);
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

/**
 * What the TUI checks before asking for a target or a URL: the same refusals the wrap would
 * produce (stale note, formatting crossed, heading, empty), without writing anything.
 */
export const checkSelection = (
  deps: AppDeps,
  scope: Scope,
  input: WrapSelectionInput,
): Promise<Result<void, AppError>> =>
  withScope(deps, scope, async (session) => {
    const located = await locate(deps, session, input);
    if (!located.ok) return located;
    const edit = planWrap(deps, located.value, input, (text) => text);
    return edit.ok ? ok(undefined) : edit;
  });

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
