import { ambiguous, notFound, type AppError } from '../../domain/errors.js';
import { isNote, type Note, type NoteEntry } from '../../domain/note/note.js';
import { err, ok, type Result } from '../../domain/result.js';

/**
 * Resolves user input to one note: canonical id first, then title or alias
 * (case-insensitive). Duplicate ids and ambiguous names are reported, never guessed.
 */
export const resolveEntry = (
  entries: readonly NoteEntry[],
  query: string,
): Result<Note, AppError> => {
  const notes = entries.filter(isNote);

  const byId = notes.filter((n) => n.id === query);
  const [firstById, secondById] = byId;
  if (secondById) {
    return err(
      ambiguous(`Duplicate identity: ${String(byId.length)} notes share id ${query}`, {
        id: query,
        paths: byId.map((n) => n.path),
      }),
    );
  }
  if (firstById) return ok(firstById);

  const needle = query.toLowerCase();
  const byName = notes.filter(
    (n) => n.title.toLowerCase() === needle || n.aliases.some((a) => a.toLowerCase() === needle),
  );
  const [firstByName, secondByName] = byName;
  if (secondByName) {
    return err(
      ambiguous(`"${query}" matches ${String(byName.length)} notes`, {
        query,
        candidates: byName.map((n) => ({ id: n.id, title: n.title, path: n.path })),
      }),
    );
  }
  if (firstByName) return ok(firstByName);
  return err(notFound(`No note with id, title or alias "${query}"`, { query }));
};
