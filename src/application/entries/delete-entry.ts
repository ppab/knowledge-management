import { conflict, type AppError } from '../../domain/errors.js';
import { isEntry, type AnyEntry } from '../../domain/entry/entry.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Revision } from '../../domain/revision/revision.js';
import type { Scope } from '../../domain/scope/scope.js';
import { REVISION_SCOPE } from '../history/snapshot-entry.js';
import type { AppDeps } from '../ports.js';
import { withScope, type ScopeSession } from '../scope/session.js';
import type { VaultHandle } from '../vault/vault.js';
import { locateEntry, type LocatedEntry, type EntryLocator } from './view-entry.js';

/*
 * Removing a note is more than unlinking a file: other notes may link to it, and in a
 * versioned vault the deletion itself belongs in history. So `delete` refuses by default when
 * something links in (unless `force`), and when the note was tracked it records the removal as
 * a `note:`-scoped revision, just like `save` records a change.
 */

export interface DeleteInput {
  /** Delete even when other notes link to this one, leaving those links dangling. */
  readonly force?: boolean;
  /** Message for the revision that records the deletion; default `note: delete <title>`. */
  readonly message?: string;
}

/** A note that links to the one being deleted; its reference would be left dangling. */
export interface Referrer {
  readonly vault: string;
  readonly path: string;
  readonly title: string;
  readonly id?: string;
}

export type DeleteRecord =
  /** Recorded as a revision: the vault is versioned and the note was tracked. */
  | { readonly kind: 'recorded'; readonly revision: Revision }
  /** Removed but not recorded: the note had never been committed. */
  | { readonly kind: 'unrecorded' }
  /** Removed; the vault is not under version control. */
  | { readonly kind: 'unversioned' };

export interface DeletedEntry {
  readonly vault: VaultHandle;
  /** The entry as it was read just before removal. */
  readonly entry: AnyEntry;
  /** Notes that linked to it; non-empty only when `force` carried the deletion through. */
  readonly referrers: readonly Referrer[];
  readonly record: DeleteRecord;
}

export interface DeletePreview {
  readonly vault: VaultHandle;
  readonly entry: AnyEntry;
  readonly referrers: readonly Referrer[];
}

/** `note: <message>`; a message that already carries the scope is left alone (as `save` does). */
export const deleteMessage = (entry: AnyEntry, message?: string): string => {
  const text = message?.trim();
  const body = text === undefined || text === '' ? `delete ${entry.title}` : text;
  return body.toLowerCase().startsWith(`${REVISION_SCOPE}:`) ? body : `${REVISION_SCOPE}: ${body}`;
};

/** Every note across the scope that links to `located` by id; deduped per source note. */
const collectReferrers = (session: ScopeSession, located: LocatedEntry): Referrer[] => {
  const { vault, entry } = located;
  if (!isEntry(entry)) return []; // an unidentified file has no id to be linked by
  const seen = new Set<string>();
  const referrers: Referrer[] = [];
  for (const opened of session.opened) {
    for (const ref of opened.index.backlinks(entry.id)) {
      // A note's reference to itself is not an inbound link that deletion would orphan.
      if (opened.vault.root === vault.root && ref.sourcePath === entry.path) continue;
      const key = `${opened.vault.config.name}:${ref.sourcePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const summary = opened.index.byPath(ref.sourcePath);
      referrers.push({
        vault: opened.vault.config.name,
        path: ref.sourcePath,
        title: summary?.title ?? ref.sourcePath,
        ...(summary?.kind === 'entry' && { id: summary.id }),
      });
    }
  }
  return referrers;
};

/** What `deleteEntry` would remove and which notes link to it, without deleting anything. */
export const previewDelete = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
): Promise<Result<DeletePreview, AppError>> =>
  withScope(deps, scope, async (session) => {
    const found = await locateEntry(deps, session, locator);
    if (!found.ok) return found;
    return ok({
      vault: found.value.vault,
      entry: found.value.entry,
      referrers: collectReferrers(session, found.value),
    });
  });

export const deleteEntry = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
  input: DeleteInput = {},
): Promise<Result<DeletedEntry, AppError>> =>
  withScope(deps, scope, async (session): Promise<Result<DeletedEntry, AppError>> => {
    const found = await locateEntry(deps, session, locator);
    if (!found.ok) return found;
    const { vault, entry } = found.value;
    const referrers = collectReferrers(session, found.value);
    if (referrers.length > 0 && input.force !== true) {
      return err(
        conflict(
          `${entry.path} is linked from ${String(referrers.length)} other note(s); pass --force to delete it anyway`,
          {
            path: entry.path,
            referrers: referrers.map((r) => ({ vault: r.vault, path: r.path })),
          },
        ),
      );
    }
    // The versioning state has to be read before the file is gone, to tell a tracked note
    // (whose deletion is worth recording) from one that was never committed.
    const status = await deps.revisions.status(vault.root, entry.path);
    if (!status.ok) return status;
    const removed = await deps.entries.delete(vault.root, entry.path, {
      expectedVersion: entry.version,
    });
    if (!removed.ok) return removed;
    // Drop it from the open index at once; a later refresh would reconcile it anyway.
    session.opened.find((o) => o.vault.root === vault.root)?.index.remove(entry.path);

    if (status.value.kind === 'unversioned') {
      return ok({ vault, entry, referrers, record: { kind: 'unversioned' } });
    }
    if (status.value.kind === 'unrecorded') {
      return ok({ vault, entry, referrers, record: { kind: 'unrecorded' } });
    }
    const recorded = await deps.revisions.record(
      vault.root,
      entry.path,
      deleteMessage(entry, input.message),
    );
    if (!recorded.ok) return recorded;
    return ok({ vault, entry, referrers, record: { kind: 'recorded', revision: recorded.value } });
  });
