import { validation, type AppError } from '../errors.js';
import type { Heading } from '../note/note.js';
import { err, ok, type Result } from '../result.js';
import { replaceRange, type SourceRange, type TextEdit } from './text-edit.js';

/*
 * A selection may be wrapped (as a reference or an external link) only when it lies inside
 * one prose span: this is what guarantees we never split emphasis, links or code spans, and
 * never rewrite a heading's text.
 */

export interface SelectableLayout {
  readonly source: string;
  readonly textSpans: readonly SourceRange[];
  readonly headings: readonly Heading[];
}

const within = (inner: SourceRange, outer: SourceRange): boolean =>
  inner.start >= outer.start && inner.end <= outer.end;

export const wrapSelection = (
  layout: SelectableLayout,
  selection: SourceRange,
  wrap: (text: string) => string,
): Result<TextEdit, AppError> => {
  if (selection.start >= selection.end) {
    return err(validation('Selection is empty', { selection }));
  }
  if (!layout.textSpans.some((span) => within(selection, span))) {
    return err(validation('Selection must lie inside a single run of plain text', { selection }));
  }
  if (layout.headings.some((h) => within(selection, h.range))) {
    return err(validation('Heading text cannot be wrapped', { selection }));
  }
  const text = layout.source.slice(selection.start, selection.end);
  if (text.includes('[[') || text.includes(']]')) {
    return err(validation('Selection already contains a reference', { selection }));
  }
  return ok(replaceRange(selection, wrap(text)));
};
