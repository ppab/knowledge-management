import { conflict, type AppError } from '../../domain/errors.js';
import type { Note } from '../../domain/note/note.js';
import type { NoteSummary } from '../../domain/note/summary.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { readNoteInScope, withScope, type LocatedNote } from '../scope/session.js';
import type { AppDeps, NoteIndex } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadNoteEntry } from './load-note.js';
import { resolveEntry } from './resolve-entry.js';

/**
 * Reads the file behind an index summary: the index never serves content, and the returned
 * `version` is what a later write must present.
 */
export const readNoteFile = async (
  deps: AppDeps,
  vault: VaultHandle,
  summary: NoteSummary,
): Promise<Result<Note, AppError>> => {
  const doc = await deps.notes.read(vault.root, summary.path);
  if (!doc.ok) return doc;
  const entry = loadNoteEntry(deps, doc.value);
  if (entry.kind !== 'note' || entry.id !== summary.id) {
    return err(
      conflict(`${summary.path} changed while it was being read; retry`, { path: summary.path }),
    );
  }
  return ok(entry);
};

/** Single-vault resolution and read, for callers that already hold the vault's index. */
export const readNote = async (
  deps: AppDeps,
  vault: VaultHandle,
  index: NoteIndex,
  query: string,
): Promise<Result<Note, AppError>> => {
  const summary = resolveEntry(index, query);
  if (!summary.ok) return summary;
  return readNoteFile(deps, vault, summary.value);
};

export const showNote = (
  deps: AppDeps,
  scope: Scope,
  query: string,
): Promise<Result<LocatedNote, AppError>> =>
  withScope(deps, scope, (session) => readNoteInScope(deps, session, query));
