import type { SourceRange } from './text-edit.js';

/*
 * The rendered form of a note for the terminal, with the map back to the source that selection
 * and reference navigation need. A span either comes straight from the source (`source` set,
 * and then `text` is exactly that slice), or it is synthetic: a list bullet, a heading marker,
 * a reference shown by its label or title. Only source-backed spans can be selected.
 */

export interface SpanStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strikethrough?: boolean;
  readonly code?: boolean;
  readonly dim?: boolean;
  /** Set on every span of a heading line. */
  readonly heading?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly link?: boolean;
}

export interface Span {
  readonly text: string;
  /** Where `text` comes from; `source.slice(start, end) === text` always holds. */
  readonly source?: SourceRange;
  /** Index into the note's references when this span displays one. */
  readonly reference?: number;
  readonly style?: SpanStyle;
}

export interface RenderedLine {
  readonly spans: readonly Span[];
}

export const lineText = (line: RenderedLine): string => line.spans.map((s) => s.text).join('');

/** The line (and span) that displays reference `index`, or `null` when none does. */
export const findReferenceSpan = (
  lines: readonly RenderedLine[],
  index: number,
): { line: number; span: number } | null => {
  for (const [l, line] of lines.entries()) {
    const s = line.spans.findIndex((span) => span.reference === index);
    if (s >= 0) return { line: l, span: s };
  }
  return null;
};

/**
 * The source offset under a rendered position, or `null` on synthetic text or past the end of
 * the line. Columns count characters; `column === lineText.length` maps to the end of the
 * last source-backed span so a selection can include the last character.
 */
export const sourceOffsetAt = (line: RenderedLine, column: number): number | null => {
  let col = 0;
  for (const span of line.spans) {
    const end = col + span.text.length;
    if (column >= col && column < end) {
      return span.source ? span.source.start + (column - col) : null;
    }
    col = end;
  }
  if (column === col) {
    const last = line.spans.findLast((span) => span.source !== undefined);
    return last?.source ? last.source.end : null;
  }
  return null;
};
