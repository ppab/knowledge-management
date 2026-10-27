import type { AppError } from '../../domain/errors.js';
import type { Note } from '../../domain/note/note.js';
import type { NoteSummary } from '../../domain/note/summary.js';
import { ok, type Result } from '../../domain/result.js';
import { mergeResolution, resolved, type ResolutionResult } from '../../domain/scope/resolution.js';
import { availableVaults, unavailableRoots, type Scope } from '../../domain/scope/scope.js';
import { refreshIndex } from '../index/refresh-index.js';
import { readNoteFile } from '../notes/show-note.js';
import type { AppDeps, NoteIndex } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';

/*
 * A scope session is every available vault of a scope with its index open and refreshed.
 * Composite queries fan out over `opened` and merge in the application layer; nothing is
 * ever stored across vaults.
 */

export interface OpenedVault {
  readonly vault: VaultHandle;
  readonly index: NoteIndex;
}

export interface ScopeSession {
  readonly scope: Scope;
  readonly opened: readonly OpenedVault[];
  /** Roots that could not be opened, or whose index could not be opened. */
  readonly unavailable: readonly string[];
}

export const withScope = async <T>(
  deps: AppDeps,
  scope: Scope,
  work: (session: ScopeSession) => Promise<Result<T, AppError>> | Result<T, AppError>,
): Promise<Result<T, AppError>> => {
  const opened: OpenedVault[] = [];
  const unavailable = [...unavailableRoots(scope)];
  try {
    for (const vault of availableVaults(scope)) {
      const index = await deps.indexes.open(vault.root);
      if (!index.ok) {
        unavailable.push(vault.root);
        continue;
      }
      opened.push({ vault, index: index.value });
      const refreshed = await refreshIndex(deps, vault, index.value);
      if (!refreshed.ok) return refreshed;
    }
    return await work({ scope, opened, unavailable });
  } finally {
    for (const { index } of opened) index.close();
  }
};

export interface ScopedSummary {
  readonly opened: OpenedVault;
  readonly summary: NoteSummary;
}

type Hit = NoteSummary & { readonly opened: OpenedVault };

const resolution = (session: ScopeSession, query: string): ResolutionResult<Hit> =>
  mergeResolution(
    session.opened.map((opened) => ({
      vault: opened.vault.config.name,
      byId: opened.index.byId(query).map((summary) => ({ ...summary, opened })),
      byName: opened.index.byName(query).map((summary) => ({ ...summary, opened })),
    })),
    session.unavailable,
  );

/** One note across the scope: id first, then title or alias (invariants 3 and 4). */
export const resolveInScope = (
  session: ScopeSession,
  query: string,
): Result<ScopedSummary, AppError> => {
  const match = resolved(query, resolution(session, query));
  if (!match.ok) return match;
  const { opened, ...summary } = match.value.note;
  return ok({ opened, summary });
};

/** Reference targets are ids only; this is the id-only branch of resolution. */
export const resolveIdInScope = (session: ScopeSession, id: string): ResolutionResult<Hit> =>
  mergeResolution(
    session.opened.map((opened) => ({
      vault: opened.vault.config.name,
      byId: opened.index.byId(id).map((summary) => ({ ...summary, opened })),
      byName: [],
    })),
    session.unavailable,
  );

export interface LocatedNote {
  readonly vault: VaultHandle;
  readonly index: NoteIndex;
  readonly note: Note;
}

/** Resolves and reads the file; the owning vault comes along for the write that may follow. */
export const readNoteInScope = async (
  deps: AppDeps,
  session: ScopeSession,
  query: string,
): Promise<Result<LocatedNote, AppError>> => {
  const located = resolveInScope(session, query);
  if (!located.ok) return located;
  const { opened, summary } = located.value;
  const note = await readNoteFile(deps, opened.vault, summary);
  if (!note.ok) return note;
  return ok({ vault: opened.vault, index: opened.index, note: note.value });
};
