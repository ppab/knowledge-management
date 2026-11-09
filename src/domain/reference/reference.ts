import type { SourceRange } from '../text/text-edit.js';
import { isEntryId, type EntryId } from '../entry/entry-id.js';

/**
 * A persistent, directed relationship to another note, addressed by canonical id only. The
 * range is the exact `[[...]]` span in the source so edits and transformations are
 * offset-precise.
 */
export interface Reference {
  readonly target: EntryId;
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
    if (id === undefined || !isEntryId(id)) continue;
    const range = { start: offset + match.index, end: offset + match.index + whole.length };
    found.push(label === undefined ? { target: id, range } : { target: id, label, range });
  }
  return found;
};

export const formatReference = (target: EntryId, label?: string): string =>
  label === undefined || label === '' ? `[[${target}]]` : `[[${target}|${label}]]`;

/** A line holding only a list marker (`- `, `* `, `1. `) and nothing else around the link. */
const LIST_MARKER_ONLY = /^\s*(?:[-*+]|\d+[.)])\s+$/;

/**
 * Whether the `[[...]]` at `range` stands alone on its line — the rest of the line is blank or
 * only a list marker. Such a reference was placed as a standalone item (how `linkReference`
 * inserts one), as opposed to one woven into a sentence. `unlinkReference` drops the whole line
 * for a standalone link; `relabel` treats one as a managed title-copy to refresh.
 */
export const isStandaloneReference = (source: string, range: SourceRange): boolean => {
  const lineStart = source.lastIndexOf('\n', range.start - 1) + 1;
  const lineEndIndex = source.indexOf('\n', range.end);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const rest = source.slice(lineStart, range.start) + source.slice(range.end, lineEnd);
  return rest.trim() === '' || LIST_MARKER_ONLY.test(rest);
};

const FIELD_REFERENCE = /^\[\[([^\s|[\]]+)(?:\|([^[\]]*))?\]\]$/;

/**
 * A frontmatter value that is exactly one `[[ID]]` or `[[ID|Label]]` is a field reference: the
 * relation lives in the Markdown itself, so it survives whichever plugin declared the field
 * (docs/plugins.md §2). A bare id is never one, since ids may not contain brackets.
 */
export const parseFieldReference = (
  value: unknown,
): { readonly target: EntryId; readonly label?: string } | null => {
  if (typeof value !== 'string') return null;
  const match = FIELD_REFERENCE.exec(value.trim());
  if (!match) return null;
  const [, id, label] = match;
  if (id === undefined || !isEntryId(id)) return null;
  return label === undefined ? { target: id } : { target: id, label };
};
