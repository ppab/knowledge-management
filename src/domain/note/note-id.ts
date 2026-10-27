import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';

declare const noteIdBrand: unique symbol;

/**
 * A permanent, globally unique identifier. Assigned once at creation and never rewritten by
 * any operation. The brand keeps raw strings (aliases, titles, paths) from being passed where
 * a canonical identity is required.
 */
export type NoteId = string & { readonly [noteIdBrand]: true };

/** Characters that would break the `[[ID|Label]]` reference syntax. */
const FORBIDDEN = /[\s|[\]]/;

export const parseNoteId = (raw: unknown): Result<NoteId, AppError> => {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return err(validation('Note id must be a string', { received: typeof raw }));
  }
  const text = String(raw);
  if (text.length === 0) return err(validation('Note id must not be empty'));
  if (FORBIDDEN.test(text)) {
    return err(validation('Note id must not contain whitespace, "|", "[" or "]"', { id: text }));
  }
  return ok(text as NoteId);
};

export const isNoteId = (raw: string): raw is NoteId => parseNoteId(raw).ok;

/** For values that were validated before being stored (e.g. read back from the index). */
export const asNoteId = (validated: string): NoteId => validated as NoteId;
