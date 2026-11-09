import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type { Revision } from '../../domain/revision/revision.js';
import type { Scope } from '../../domain/scope/scope.js';
import { locateEntry, type LocatedEntry, type EntryLocator } from '../entries/view-entry.js';
import type { AppDeps } from '../ports.js';
import { withScope } from '../scope/session.js';

/*
 * `save` is the only way a revision comes to exist (docs/architecture.md A4): explicit, one
 * note, the message the user gave. Nothing to record and nowhere to record it are outcomes,
 * not errors, so scripts can call `save` unconditionally.
 */

export interface SnapshotInput {
  /** Revision message, recorded as `note: <message>`; default: `note: snapshot <title>`. */
  readonly message?: string;
}

export type SnapshotOutcome =
  | { readonly kind: 'saved'; readonly revision: Revision }
  | { readonly kind: 'nothing-to-save'; readonly last: Revision }
  | { readonly kind: 'not-under-version-control' };

/** Every revision an entry records is scoped, so entry commits stand out in a shared repository. */
export const REVISION_SCOPE = 'note';

export const defaultSnapshotMessage = (entry: LocatedEntry['entry']): string =>
  `snapshot ${entry.title}`;

/** `note: <message>`; a message that already carries the scope is left alone. */
export const snapshotMessage = (entry: LocatedEntry['entry'], message?: string): string => {
  const text = message?.trim();
  const body = text === undefined || text === '' ? defaultSnapshotMessage(entry) : text;
  return body.toLowerCase().startsWith(`${REVISION_SCOPE}:`) ? body : `${REVISION_SCOPE}: ${body}`;
};

export interface SnapshotResult extends LocatedEntry {
  readonly outcome: SnapshotOutcome;
}

export const snapshotEntry = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
  input: SnapshotInput = {},
): Promise<Result<SnapshotResult, AppError>> =>
  withScope(deps, scope, async (session): Promise<Result<SnapshotResult, AppError>> => {
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
    const recorded = await deps.revisions.record(
      vault.root,
      entry.path,
      snapshotMessage(entry, input.message),
    );
    if (!recorded.ok) return recorded;
    return ok({ ...found.value, outcome: { kind: 'saved', revision: recorded.value } });
  });
