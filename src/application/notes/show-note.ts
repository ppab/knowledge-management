import type { AppError } from '../../domain/errors.js';
import type { Note } from '../../domain/note/note.js';
import { andThen, type Result } from '../../domain/result.js';
import type { AppDeps } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';
import { listNotes } from './list-notes.js';
import { resolveEntry } from './resolve-entry.js';

export const showNote = async (
  deps: AppDeps,
  vault: VaultHandle,
  query: string,
): Promise<Result<Note, AppError>> =>
  andThen(await listNotes(deps, vault), (entries) => resolveEntry(entries, query));
