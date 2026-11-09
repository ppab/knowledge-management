import { appError, type AppError } from '../../domain/errors.js';
import { splitFrontmatter } from '../../domain/note/frontmatter.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { replaceRange } from '../../domain/text/text-edit.js';
import { mutateNote, type MutationOutcome } from '../mutations/mutate.js';
import type { AppDeps } from '../ports.js';
import { readNoteInScope, withScope } from '../scope/session.js';

export interface SetTagsInput {
  /** Note to edit: id, title or alias. */
  readonly note: string;
  /** The complete tag set to write; order kept, blanks dropped, duplicates collapsed. */
  readonly tags: readonly string[];
  readonly dryRun?: boolean;
}

/** Splits a free-text tag line (commas and/or whitespace, an optional leading `#`) into tags. */
export const parseTagLine = (line: string): string[] =>
  line
    .split(/[\s,]+/)
    .map((raw) => raw.replace(/^#+/, '').trim())
    .filter((tag) => tag !== '');

/** Drops blanks and duplicates, keeping first occurrence order. */
const normalize = (tags: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const t = tag.trim();
    if (t !== '' && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
};

/**
 * Replaces the note's `tags:` with `input.tags` (normalized). Writing the same set again is a
 * successful no-op; an empty set removes the key. A set editor, not an add/remove — the caller
 * (the `t` prompt) pre-fills the current tags and the user edits the whole set.
 */
export const setTags = (
  deps: AppDeps,
  scope: Scope,
  input: SetTagsInput,
): Promise<Result<MutationOutcome, AppError>> =>
  withScope(deps, scope, async (session) => {
    const located = await readNoteInScope(deps, session, input.note);
    if (!located.ok) return located;
    const { vault, index, note } = located.value;
    const next = normalize(input.tags);
    if (next.join('\n') === [...note.tags].join('\n')) {
      return ok({ path: note.path, written: false, dryRun: input.dryRun ?? false });
    }
    const block = splitFrontmatter(note.source);
    if (!block) {
      return err(appError('INTERNAL', `${note.path} has an id but no frontmatter block`));
    }
    const yaml = deps.frontmatter.update(
      block.yaml,
      next.length === 0 ? { remove: ['tags'] } : { set: { tags: next } },
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
