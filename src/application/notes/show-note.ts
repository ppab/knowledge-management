import { conflict, type AppError } from '../../domain/errors.js';
import type { Note } from '../../domain/note/note.js';
import { err, ok, type Result } from '../../domain/result.js';
import { withFreshIndex } from '../index/refresh-index.js';
import type { AppDeps } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadNoteEntry } from './load-note.js';
import { resolveEntry } from './resolve-entry.js';

/** Resolves through the index, then reads the file itself: the index never serves content. */
export const showNote = (
  deps: AppDeps,
  vault: VaultHandle,
  query: string,
): Promise<Result<Note, AppError>> =>
  withFreshIndex(deps, vault, async (index) => {
    const summary = resolveEntry(index, query);
    if (!summary.ok) return summary;
    const doc = await deps.notes.read(vault.root, summary.value.path);
    if (!doc.ok) return doc;
    const entry = loadNoteEntry(deps, doc.value);
    if (entry.kind !== 'note' || entry.id !== summary.value.id) {
      return err(
        conflict(`${summary.value.path} changed while it was being read; retry`, {
          path: summary.value.path,
        }),
      );
    }
    return ok(entry);
  });
