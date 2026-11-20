import type { AppError } from '../../domain/errors.js';
import { formatReference } from '../../domain/reference/reference.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { Entry } from '../../domain/entry/entry.js';
import {
  locateInsertion,
  type InsertionLocation,
  type InsertionPlan,
} from '../../domain/text/insertion.js';
import { checkVersion, mutateEntry, type MutationOutcome } from '../mutations/mutate.js';
import type { AppDeps } from '../ports.js';
import { readEntryInScope, resolveInScope, withScope } from '../scope/session.js';

export interface LinkReferenceInput {
  /** Entry to edit: id, title or alias. */
  readonly source: string;
  /** Entry to point at, anywhere in the scope: id, title or alias; the canonical id is written. */
  readonly target: string;
  readonly at?: InsertionLocation;
  readonly label?: string;
  /** Version of the source note the caller looked at; a different one on disk is a conflict. */
  readonly expectedVersion?: string;
  readonly dryRun?: boolean;
}

/** The note is still the one looked at, and `block` has a place at `at`. */
const planAt = (
  deps: AppDeps,
  note: Entry,
  at: InsertionLocation | undefined,
  block: string,
  expectedVersion: string | undefined,
): Result<InsertionPlan, AppError> => {
  const fresh = checkVersion(note, expectedVersion);
  if (!fresh.ok) return fresh;
  const parsed = deps.markdown.parse(note.source, note.body.start);
  return locateInsertion(
    {
      source: note.source,
      bodyStart: note.body.start,
      headings: note.headings,
      textSpans: parsed.textSpans,
    },
    at ?? { kind: 'end' },
    block,
  );
};

export interface InsertionPointInput {
  readonly source: string;
  readonly at: InsertionLocation;
  readonly expectedVersion?: string;
}

/**
 * What the TUI checks before asking for a target: the same refusals `linkReference` would
 * give for the location (stale note, cursor off prose, heading), without writing anything.
 */
export const checkInsertionPoint = (
  deps: AppDeps,
  scope: Scope,
  input: InsertionPointInput,
): Promise<Result<void, AppError>> =>
  withScope(deps, scope, async (session) => {
    const located = await readEntryInScope(deps, session, input.source);
    if (!located.ok) return located;
    const planned = planAt(deps, located.value.note, input.at, '[[?]]', input.expectedVersion);
    return planned.ok ? ok(undefined) : planned;
  });

export const linkReference = (
  deps: AppDeps,
  scope: Scope,
  input: LinkReferenceInput,
): Promise<Result<MutationOutcome, AppError>> =>
  withScope(deps, scope, async (session) => {
    const target = resolveInScope(session, input.target);
    if (!target.ok) return target;
    const located = await readEntryInScope(deps, session, input.source);
    if (!located.ok) return located;
    const { vault, index, note } = located.value;
    const plan = planAt(
      deps,
      note,
      input.at,
      formatReference(target.value.summary.id, input.label ?? target.value.summary.title),
      input.expectedVersion,
    );
    if (!plan.ok) return plan;
    return mutateEntry(
      deps,
      vault,
      index,
      note,
      [plan.value.edit],
      { referenceDelta: 1, addedHeadings: plan.value.addsHeadings, frontmatter: 'unchanged' },
      { dryRun: input.dryRun ?? false },
    );
  });
