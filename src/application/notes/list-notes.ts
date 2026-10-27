import type { AppError } from '../../domain/errors.js';
import type { NoteEntry } from '../../domain/note/note.js';
import { ok, type Result } from '../../domain/result.js';
import type { AppDeps } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadNoteEntry } from './load-note.js';

/** Scans the vault's files. The SQLite index (M2) will replace this for reads. */
export const listNotes = async (
  deps: AppDeps,
  vault: VaultHandle,
): Promise<Result<NoteEntry[], AppError>> => {
  const paths = await deps.notes.list(vault.root, vault.config.include, vault.config.exclude);
  const entries: NoteEntry[] = [];
  for (const path of paths.sort()) {
    const doc = await deps.notes.read(vault.root, path);
    if (!doc.ok) return doc;
    entries.push(loadNoteEntry(deps, doc.value));
  }
  return ok(entries);
};
