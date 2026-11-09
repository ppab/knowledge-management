import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';

declare const entryIdBrand: unique symbol;

/**
 * A permanent, globally unique identifier. Assigned once at creation and never rewritten by
 * any operation. The brand keeps raw strings (aliases, titles, paths) from being passed where
 * a canonical identity is required.
 */
export type EntryId = string & { readonly [entryIdBrand]: true };

/** Characters that would break the `[[ID|Label]]` reference syntax. */
const FORBIDDEN = /[\s|[\]]/;

export const parseEntryId = (raw: unknown): Result<EntryId, AppError> => {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return err(validation('Entry id must be a string', { received: typeof raw }));
  }
  const text = String(raw);
  if (text.length === 0) return err(validation('Entry id must not be empty'));
  if (FORBIDDEN.test(text)) {
    return err(validation('Entry id must not contain whitespace, "|", "[" or "]"', { id: text }));
  }
  return ok(text as EntryId);
};

export const isEntryId = (raw: string): raw is EntryId => parseEntryId(raw).ok;

/** For values that were validated before being stored (e.g. read back from the index). */
export const asEntryId = (validated: string): EntryId => validated as EntryId;
