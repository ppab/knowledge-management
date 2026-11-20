import { appError, validation, type AppError } from '../../domain/errors.js';
import { splitFrontmatter } from '../../domain/entry/frontmatter.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { replaceRange } from '../../domain/text/text-edit.js';
import { mutateEntry, type MutationOutcome } from '../mutations/mutate.js';
import type { AppDeps } from '../ports.js';
import { readEntryInScope, withScope } from '../scope/session.js';

export interface ClassifyInput {
  /** Entry to classify: id, title or alias. */
  readonly query: string;
  /** The type to file it under; omitted with `clear` to send it back to the inbox. */
  readonly type?: string;
  /** Remove the `type`, returning the entry to a raw, unclassified capture. */
  readonly clear?: boolean;
  readonly dryRun?: boolean;
}

/**
 * Sets (or clears) an entry's `type` — the domain axis. A present `type` files a raw capture
 * under a kind a plugin may own; clearing it returns the entry to the inbox. The core stays
 * type-agnostic: any non-empty string is a valid type, whether or not a plugin claims it.
 * Classifying to the type it already has (or clearing an already-typeless entry) is a no-op.
 */
export const classifyEntry = (
  deps: AppDeps,
  scope: Scope,
  input: ClassifyInput,
): Promise<Result<MutationOutcome, AppError>> => {
  const clearing = input.clear === true;
  const next = clearing ? undefined : input.type?.trim();
  if (!clearing && (next === undefined || next === '')) {
    return Promise.resolve(err(validation('Provide a type to classify under, or --clear')));
  }
  return withScope(deps, scope, async (session) => {
    const located = await readEntryInScope(deps, session, input.query);
    if (!located.ok) return located;
    const { vault, index, note } = located.value;
    if (note.type === next) {
      return ok({ path: note.path, written: false, dryRun: input.dryRun ?? false });
    }
    const block = splitFrontmatter(note.source);
    if (!block) {
      return err(appError('INTERNAL', `${note.path} has an id but no frontmatter block`));
    }
    const yaml = deps.frontmatter.update(
      block.yaml,
      next === undefined ? { remove: ['type'] } : { set: { type: next } },
    );
    if (!yaml.ok) return yaml;
    return mutateEntry(
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
