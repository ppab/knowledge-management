import { validation, type AppError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
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

/** The reference displayed at `column` of a line, or `null`. */
export const referenceAt = (line: RenderedLine, column: number): number | null => {
  let col = 0;
  for (const span of line.spans) {
    const end = col + span.text.length;
    if (column >= col && column < end) return span.reference ?? null;
    col = end;
  }
  return null;
};

/** Where each reference starts on screen, in reference order. */
export const referencePositions = (
  lines: readonly RenderedLine[],
): { readonly reference: number; readonly line: number; readonly column: number }[] => {
  const out: { reference: number; line: number; column: number }[] = [];
  lines.forEach((line, l) => {
    let column = 0;
    for (const span of line.spans) {
      if (span.reference !== undefined) out.push({ reference: span.reference, line: l, column });
      column += span.text.length;
    }
  });
  return out.sort((a, b) => a.reference - b.reference);
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

/** A place in the rendered text: `line` into the lines, `column` in UTF-16 units of its text. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

export const comparePositions = (a: Position, b: Position): number =>
  a.line === b.line ? a.column - b.column : a.line - b.line;

/** Length in UTF-16 units of the character at `column` (2 for an astral code point). */
export const charLengthAt = (text: string, column: number): number => {
  const code = text.codePointAt(column);
  return code === undefined ? 0 : code > 0xffff ? 2 : 1;
};

/**
 * The source range covered by a selection between two rendered positions (both inclusive),
 * or a validation error when either end sits on synthetic text (bullets, markers, reference
 * labels, blank lines). Whether the range is wrappable (one prose run, no heading) is the
 * domain's `wrapSelection` rule; this only maps the ends.
 */
export const selectedRange = (
  lines: readonly RenderedLine[],
  anchor: Position,
  head: Position,
): Result<SourceRange, AppError> => {
  const [first, last] = comparePositions(anchor, head) <= 0 ? [anchor, head] : [head, anchor];
  const firstLine = lines[first.line];
  const lastLine = lines[last.line];
  const start = firstLine ? sourceOffsetAt(firstLine, first.column) : null;
  const lastOffset = lastLine ? sourceOffsetAt(lastLine, last.column) : null;
  if (start === null || lastOffset === null || !lastLine) {
    return err(validation('Selection must start and end on note text', { anchor, head }));
  }
  const end = lastOffset + charLengthAt(lineText(lastLine), last.column);
  return ok({ start, end });
};
