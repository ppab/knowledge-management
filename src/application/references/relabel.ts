import type { AppError } from '../../domain/errors.js';
import type { Note } from '../../domain/note/note.js';
import { isNoteSummary } from '../../domain/note/summary.js';
import { formatReference, isStandaloneReference } from '../../domain/reference/reference.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { replaceRange, type TextEdit } from '../../domain/text/text-edit.js';
import { checkVersion, mutateNote, type MutationOutcome } from '../mutations/mutate.js';
import { readNoteFile } from '../notes/show-note.js';
import type { AppDeps } from '../ports.js';
import {
  readNoteInScope,
  withScope,
  type OpenedVault,
  type ScopeSession,
} from '../scope/session.js';
import { resolveTarget } from './references.js';

export interface RelabelInput {
  /** Note to relabel: id, title or alias. */
  readonly source: string;
  readonly expectedVersion?: string;
  readonly dryRun?: boolean;
}

/**
 * Edits that refresh a note's *standalone* `[[links]]` so each shows its target's current title
 * (`[[id|Title]]`). Inline references — woven into a sentence — are intentional prose and left
 * alone (position heuristic, see `isStandaloneReference`); so are links whose target no longer
 * resolves in scope, and ones already showing the right title.
 */
const planRelabel = (session: ScopeSession, note: Note): TextEdit[] => {
  const edits: TextEdit[] = [];
  for (const ref of note.references) {
    if (!isStandaloneReference(note.source, ref.range)) continue;
    const resolution = resolveTarget(session, ref.target);
    if (resolution.state !== 'resolved') continue;
    const next = formatReference(resolution.note.id, resolution.note.title);
    if (note.source.slice(ref.range.start, ref.range.end) === next) continue;
    edits.push(replaceRange(ref.range, next));
  }
  return edits;
};

const applyRelabel = (
  deps: AppDeps,
  session: ScopeSession,
  opened: OpenedVault,
  note: Note,
  dryRun: boolean,
): Promise<Result<MutationOutcome, AppError>> => {
  const edits = planRelabel(session, note);
  if (edits.length === 0) {
    return Promise.resolve(ok({ path: note.path, written: false, dryRun }));
  }
  // Relabelling only rewrites the label slot of existing links: the targets, and so the
  // reference count, are unchanged, and the frontmatter is untouched.
  return mutateNote(
    deps,
    opened.vault,
    opened.index,
    note,
    edits,
    { referenceDelta: 0, frontmatter: 'unchanged' },
    { dryRun },
  );
};

/** Refresh one note's standalone links to its targets' current titles. */
export const relabelReferences = (
  deps: AppDeps,
  scope: Scope,
  input: RelabelInput,
): Promise<Result<MutationOutcome, AppError>> =>
  withScope(deps, scope, async (session) => {
    const located = await readNoteInScope(deps, session, input.source);
    if (!located.ok) return located;
    const fresh = checkVersion(located.value.note, input.expectedVersion);
    if (!fresh.ok) return fresh;
    const { vault, index, note } = located.value;
    return applyRelabel(deps, session, { vault, index }, note, input.dryRun ?? false);
  });

export interface RelabelAllResult {
  /** Identified notes examined across the scope. */
  readonly scanned: number;
  /** The notes that actually changed (or, for a dry run, would change), with their outcome. */
  readonly outcomes: readonly MutationOutcome[];
}

/** Refresh standalone links across every identified note in the scope, in one session. */
export const relabelAll = (
  deps: AppDeps,
  scope: Scope,
  input: { readonly dryRun?: boolean } = {},
): Promise<Result<RelabelAllResult, AppError>> =>
  withScope(deps, scope, async (session) => {
    const dryRun = input.dryRun ?? false;
    const outcomes: MutationOutcome[] = [];
    let scanned = 0;
    for (const opened of session.opened) {
      for (const summary of opened.index.all().filter(isNoteSummary)) {
        scanned += 1;
        const note = await readNoteFile(deps, opened.vault, summary);
        if (!note.ok) return note;
        const outcome = await applyRelabel(deps, session, opened, note.value, dryRun);
        if (!outcome.ok) return outcome;
        if (outcome.value.written || (dryRun && outcome.value.diff !== undefined)) {
          outcomes.push(outcome.value);
        }
      }
    }
    return ok({ scanned, outcomes });
  });
