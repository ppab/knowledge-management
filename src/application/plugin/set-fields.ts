import { appError, validation, type AppError } from '../../domain/errors.js';
import { extractFields, type FieldValue } from '../../domain/note/fields.js';
import { KNOWN_KEYS, splitFrontmatter } from '../../domain/note/frontmatter.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { replaceRange } from '../../domain/text/text-edit.js';
import { mutateNote, type MutationOutcome } from '../mutations/mutate.js';
import type { AppDeps } from '../ports.js';
import { readNoteInScope, withScope } from '../scope/session.js';

export interface SetFieldsInput {
  /** Note to edit: id, title or alias. */
  readonly note: string;
  /** `null` removes the key; anything else sets it through the YAML codec. */
  readonly fields: Readonly<Record<string, FieldValue | null>>;
  readonly dryRun?: boolean;
}

const same = (a: FieldValue | undefined, b: FieldValue | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A frontmatter-only mutation that sets or removes keys the core does not interpret; what a
 * todo's `done` or an expense's `amount` edit becomes. Core keys are refused: `id` and
 * `title` have their own rules, `dates` has `bind`.
 */
export const setFields = (
  deps: AppDeps,
  scope: Scope,
  input: SetFieldsInput,
): Promise<Result<MutationOutcome, AppError>> => {
  const reserved = Object.keys(input.fields).filter((key) =>
    (KNOWN_KEYS as readonly string[]).includes(key),
  );
  if (reserved.length > 0) {
    return Promise.resolve(
      err(
        validation(`Cannot set core key(s) through fields: ${reserved.join(', ')}`, {
          keys: reserved,
        }),
      ),
    );
  }
  if (Object.keys(input.fields).length === 0) {
    return Promise.resolve(err(validation('No fields to set')));
  }
  return withScope(deps, scope, async (session) => {
    const located = await readNoteInScope(deps, session, input.note);
    if (!located.ok) return located;
    const { vault, index, note } = located.value;
    const current = extractFields(note.frontmatter);
    const set: Record<string, FieldValue> = {};
    const remove: string[] = [];
    for (const [key, value] of Object.entries(input.fields)) {
      if (value === null) {
        if (current[key] !== undefined) remove.push(key);
      } else if (!same(current[key], value)) set[key] = value;
    }
    const dryRun = input.dryRun ?? false;
    if (remove.length === 0 && Object.keys(set).length === 0) {
      return ok({ path: note.path, written: false, dryRun });
    }
    const block = splitFrontmatter(note.source);
    if (!block) {
      return err(appError('INTERNAL', `${note.path} has an id but no frontmatter block`));
    }
    const yaml = deps.frontmatter.update(block.yaml, { set, remove });
    if (!yaml.ok) return yaml;
    return mutateNote(
      deps,
      vault,
      index,
      note,
      [replaceRange(block.yamlRange, yaml.value)],
      { referenceDelta: 0, frontmatter: 'changed' },
      { dryRun },
    );
  });
};
