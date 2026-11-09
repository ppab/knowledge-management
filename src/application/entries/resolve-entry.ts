import { ambiguous, notFound, type AppError } from '../../domain/errors.js';
import type { EntrySummary } from '../../domain/entry/summary.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { EntryIndex } from '../ports.js';

/**
 * Resolves user input to one note: canonical id first, then title or alias
 * (case-insensitive). Duplicate ids and ambiguous names are reported, never guessed.
 */
export const resolveEntry = (index: EntryIndex, query: string): Result<EntrySummary, AppError> => {
  const byId = index.byId(query);
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

  const byName = index.byName(query);
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
