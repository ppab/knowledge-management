import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type { Revision } from '../../domain/revision/revision.js';
import type { Scope } from '../../domain/scope/scope.js';
import { locateEntry, type LocatedEntry, type NoteLocator } from '../notes/view-note.js';
import type { AppDeps } from '../ports.js';
import { withScope } from '../scope/session.js';

/*
 * `save` is the only way a revision comes to exist (docs/architecture.md A4): explicit, one
 * note, the message the user gave. Nothing to record and nowhere to record it are outcomes,
 * not errors, so scripts can call `save` unconditionally.
 */

export interface SaveInput {
  /** Revision message; default: `Save <title>`. */
  readonly message?: string;
}

export type SaveOutcome =
  | { readonly kind: 'saved'; readonly revision: Revision }
  | { readonly kind: 'nothing-to-save'; readonly last: Revision }
  | { readonly kind: 'not-under-version-control' };

export const defaultSaveMessage = (entry: LocatedEntry['entry']): string => `Save ${entry.title}`;

export interface SavedNote extends LocatedEntry {
  readonly outcome: SaveOutcome;
}

export const saveNote = (
  deps: AppDeps,
  scope: Scope,
  locator: NoteLocator,
  input: SaveInput = {},
): Promise<Result<SavedNote, AppError>> =>
  withScope(deps, scope, async (session): Promise<Result<SavedNote, AppError>> => {
    const found = await locateEntry(deps, session, locator);
    if (!found.ok) return found;
    const { vault, entry } = found.value;
    const status = await deps.revisions.status(vault.root, entry.path);
    if (!status.ok) return status;
    const current = status.value;
    if (current.kind === 'unversioned') {
      return ok({ ...found.value, outcome: { kind: 'not-under-version-control' } });
    }
    if (current.kind === 'clean') {
      return ok({ ...found.value, outcome: { kind: 'nothing-to-save', last: current.last } });
    }
    const message = input.message?.trim();
    const recorded = await deps.revisions.record(
      vault.root,
      entry.path,
      message === undefined || message === '' ? defaultSaveMessage(entry) : message,
    );
    if (!recorded.ok) return recorded;
    return ok({ ...found.value, outcome: { kind: 'saved', revision: recorded.value } });
  });
