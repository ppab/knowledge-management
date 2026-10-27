import {
  bindDate as bind,
  parseIsoDate,
  unbindDate as unbind,
} from '../../domain/calendar/date-binding.js';
import { appError, type AppError } from '../../domain/errors.js';
import { splitFrontmatter } from '../../domain/note/frontmatter.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { replaceRange } from '../../domain/text/text-edit.js';
import { mutateNote, type MutationOutcome } from '../mutations/mutate.js';
import type { AppDeps } from '../ports.js';
import { readNoteInScope, withScope } from '../scope/session.js';

export interface BindDateInput {
  /** Note to edit: id, title or alias. */
  readonly note: string;
  readonly date: string;
  readonly remove?: boolean;
  readonly dryRun?: boolean;
}

/**
 * Adds (or removes) one date in the note's `dates:` set. Binding a date twice or removing an
 * absent one is a successful no-op: nothing is written.
 */
export const bindDate = (
  deps: AppDeps,
  scope: Scope,
  input: BindDateInput,
): Promise<Result<MutationOutcome, AppError>> => {
  const date = parseIsoDate(input.date);
  if (!date.ok) return Promise.resolve(date);
  return withScope(deps, scope, async (session) => {
    const located = await readNoteInScope(deps, session, input.note);
    if (!located.ok) return located;
    const { vault, index, note } = located.value;
    const current = note.dates;
    const next = input.remove ? unbind(current, date.value) : bind(current, date.value);
    if (next.join('\n') === [...current].sort().join('\n')) {
      return ok({ path: note.path, written: false, dryRun: input.dryRun ?? false });
    }
    const block = splitFrontmatter(note.source);
    if (!block) {
      return err(appError('INTERNAL', `${note.path} has an id but no frontmatter block`));
    }
    const yaml = deps.frontmatter.update(
      block.yaml,
      next.length === 0 ? { remove: ['dates'] } : { set: { dates: next } },
    );
    if (!yaml.ok) return yaml;
    return mutateNote(
      deps,
      vault,
      index,
      note,
      [replaceRange(block.yamlRange, yaml.value)],
      { referenceDelta: 0, frontmatter: 'changed' },
      { dryRun: input.dryRun ?? false },
    );
  });
};
