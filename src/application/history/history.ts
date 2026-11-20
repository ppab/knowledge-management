import type { AppError } from '../../domain/errors.js';
import { notFound } from '../../domain/errors.js';
import type { AnyEntry } from '../../domain/entry/entry.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  findRevision,
  previousRevision,
  type Revision,
  type RevisionStatus,
} from '../../domain/revision/revision.js';
import type { Scope } from '../../domain/scope/scope.js';
import { unifiedDiff } from '../../domain/text/diff.js';
import { loadEntry } from '../entries/load-entry.js';
import { locateEntry, type LocatedEntry, type EntryLocator } from '../entries/view-entry.js';
import type { AppDeps } from '../ports.js';
import { withScope } from '../scope/session.js';

/*
 * Reading a note's past (docs/architecture.md A5): revisions are whatever the provider
 * recorded, the working file is never one of them, and historical content is parsed on the
 * fly, never indexed. Every use case addresses the note like the viewer does (`EntryLocator`),
 * so unidentified files have a history too.
 */

export interface EntryHistory extends LocatedEntry {
  readonly status: RevisionStatus;
  /** Newest first; empty when nothing was recorded or the vault is unversioned. */
  readonly revisions: readonly Revision[];
}

export const revisionStatus = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
): Promise<Result<LocatedEntry & { readonly status: RevisionStatus }, AppError>> =>
  withScope(deps, scope, async (session) => {
    const found = await locateEntry(deps, session, locator);
    if (!found.ok) return found;
    const status = await deps.revisions.status(found.value.vault.root, found.value.entry.path);
    if (!status.ok) return status;
    return ok({ ...found.value, status: status.value });
  });

const historyOf = async (
  deps: AppDeps,
  found: LocatedEntry,
): Promise<Result<EntryHistory, AppError>> => {
  const { root } = found.vault;
  const status = await deps.revisions.status(root, found.entry.path);
  if (!status.ok) return status;
  const revisions = await deps.revisions.list(root, found.entry.path);
  if (!revisions.ok) return revisions;
  return ok({ ...found, status: status.value, revisions: revisions.value });
};

export const listRevisions = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
): Promise<Result<EntryHistory, AppError>> =>
  withScope(deps, scope, async (session) => {
    const found = await locateEntry(deps, session, locator);
    if (!found.ok) return found;
    return historyOf(deps, found.value);
  });

const noRevisions = (history: EntryHistory): AppError =>
  history.status.kind === 'unversioned'
    ? notFound(`${history.entry.path} has no revisions: the vault is not under version control`, {
        path: history.entry.path,
        status: history.status.kind,
      })
    : notFound(`${history.entry.path} has no recorded revisions yet`, {
        path: history.entry.path,
        status: history.status.kind,
      });

export interface HistoricalEntry {
  readonly vault: EntryHistory['vault'];
  /** The note as it was then, parsed from the historical content (version is empty). */
  readonly entry: AnyEntry;
  readonly revision: Revision;
  /** The working file, for callers that show both. */
  readonly current: AnyEntry;
}

/** The note's content at a revision given by id or unique prefix; the index is not touched. */
export const readRevision = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
  revisionId: string,
): Promise<Result<HistoricalEntry, AppError>> =>
  withScope(deps, scope, async (session) => {
    const found = await locateEntry(deps, session, locator);
    if (!found.ok) return found;
    const history = await historyOf(deps, found.value);
    if (!history.ok) return history;
    if (history.value.revisions.length === 0) return err(noRevisions(history.value));
    const revision = findRevision(history.value.revisions, revisionId);
    if (!revision.ok) return revision;
    const source = await deps.revisions.read(found.value.vault.root, revision.value);
    if (!source.ok) return source;
    const entry = loadEntry(deps, {
      path: found.value.entry.path,
      source: source.value,
      version: '',
    });
    return ok({
      vault: found.value.vault,
      entry,
      revision: revision.value,
      current: found.value.entry,
    });
  });

export interface DiffInput {
  /** Revision id or prefix; default: the one before `to`, or the last one for the working file. */
  readonly from?: string;
  /** Revision id or prefix, or `working` (default). */
  readonly to?: string;
}

export interface RevisionDiff {
  readonly vault: EntryHistory['vault'];
  readonly entry: AnyEntry;
  readonly from: Revision;
  readonly to: Revision | 'working';
  /** Unified diff; empty when the two are identical. */
  readonly patch: string;
}

export const diffRevisions = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
  input: DiffInput = {},
): Promise<Result<RevisionDiff, AppError>> =>
  withScope(deps, scope, async (session) => {
    const found = await locateEntry(deps, session, locator);
    if (!found.ok) return found;
    const history = await historyOf(deps, found.value);
    if (!history.ok) return history;
    const { revisions, vault, entry } = history.value;
    if (revisions.length === 0) return err(noRevisions(history.value));

    let to: Revision | 'working' = 'working';
    if (input.to !== undefined && input.to !== 'working') {
      const resolved = findRevision(revisions, input.to);
      if (!resolved.ok) return resolved;
      to = resolved.value;
    }
    let from: Revision | undefined;
    if (input.from !== undefined) {
      const resolved = findRevision(revisions, input.from);
      if (!resolved.ok) return resolved;
      from = resolved.value;
    } else {
      from = to === 'working' ? revisions[0] : previousRevision(revisions, to);
    }
    if (!from) {
      return err(
        notFound(
          `Revision ${to === 'working' ? '' : to.id} is the first one; nothing precedes it`,
          {
            revision: to === 'working' ? null : to.id,
          },
        ),
      );
    }

    const before = await deps.revisions.read(vault.root, from);
    if (!before.ok) return before;
    let after = entry.source;
    if (to !== 'working') {
      const read = await deps.revisions.read(vault.root, to);
      if (!read.ok) return read;
      after = read.value;
    }
    return ok({ vault, entry, from, to, patch: unifiedDiff(before.value, after, entry.path) });
  });
