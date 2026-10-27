import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';

/** Half-open `[start, end)` character offsets into a source string. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The single mutation primitive. Every structured change to a note reduces to a set of edits
 * applied to the original source, so bytes outside the edited ranges are provably untouched.
 */
export interface TextEdit extends SourceRange {
  readonly replacement: string;
}

export const insertAt = (offset: number, text: string): TextEdit => ({
  start: offset,
  end: offset,
  replacement: text,
});

export const replaceRange = (range: SourceRange, text: string): TextEdit => ({
  ...range,
  replacement: text,
});

/**
 * Applies edits in one pass. Edits may be given in any order but must not overlap; a zero-width
 * insert at another edit's boundary is allowed. Offsets refer to the original source.
 */
export const applyEdits = (
  source: string,
  edits: readonly TextEdit[],
): Result<string, AppError> => {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  let out = '';
  for (const edit of sorted) {
    if (edit.start > edit.end || edit.start < 0 || edit.end > source.length) {
      return err(validation('Text edit out of bounds', { edit, length: source.length }));
    }
    if (edit.start < cursor) {
      return err(validation('Overlapping text edits', { edit }));
    }
    out += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return ok(out + source.slice(cursor));
};
