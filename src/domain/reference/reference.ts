import type { SourceRange } from '../text/text-edit.js';
import { isNoteId, type NoteId } from '../note/note-id.js';

/**
 * A persistent, directed relationship to another note, addressed by canonical id only. The
 * range is the exact `[[...]]` span in the source so edits and transformations are
 * offset-precise.
 */
export interface Reference {
  readonly target: NoteId;
  readonly label?: string;
  readonly range: SourceRange;
}

/** `[[ID]]` or `[[ID|Label]]`; the id may not contain whitespace, `|`, `[` or `]`. */
const REFERENCE_PATTERN = /\[\[([^\s|[\]]+)(?:\|([^[\]]*))?\]\]/g;

/**
 * Scans a plain-text span for references. Callers pass text that is known to be prose (the
 * Markdown adapter passes each mdast `text` node's source slice), so code and URLs are never
 * scanned. `offset` is the span's position in the full source.
 */
export const findReferences = (text: string, offset = 0): Reference[] => {
  const found: Reference[] = [];
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const [whole, id, label] = match;
    if (id === undefined || !isNoteId(id)) continue;
    const range = { start: offset + match.index, end: offset + match.index + whole.length };
    found.push(label === undefined ? { target: id, range } : { target: id, label, range });
  }
  return found;
};

export const formatReference = (target: NoteId, label?: string): string =>
  label === undefined || label === '' ? `[[${target}]]` : `[[${target}|${label}]]`;
