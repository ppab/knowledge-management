import {
  charLengthAt,
  comparePositions,
  lineText,
  type Position,
  type RenderedLine,
  type Span,
} from '../../domain/text/rendered.js';

/*
 * Visual selection over the rendered note (docs/architecture.md §4, "rendered↔source map").
 * The anchor is where `v` was pressed, the head is the cursor; both are inclusive and live in
 * rendered coordinates, so motions are plain text motions over the lines on screen. Mapping
 * back to the source is the domain's `selectedRange`.
 */

export interface Selection {
  readonly anchor: Position;
  readonly head: Position;
  /** Version of the note the selection was made on; a reload with another one clears it. */
  readonly version: string;
}

export type Motion = 'left' | 'right' | 'up' | 'down' | 'wordForward' | 'lineStart' | 'lineEnd';

const isLowSurrogate = (text: string, column: number): boolean => {
  const code = text.charCodeAt(column);
  return code >= 0xdc00 && code <= 0xdfff;
};

/** Column of the first source-backed character on a line, or `null` when it has none. */
const firstTextColumn = (line: RenderedLine): number | null => {
  let column = 0;
  for (const span of line.spans) {
    if (span.source !== undefined && span.text !== '') return column;
    column += span.text.length;
  }
  return null;
};

/** Where a selection starts: the first selectable character at or below `fromLine`. */
export const firstTextPosition = (
  lines: readonly RenderedLine[],
  fromLine: number,
): Position | null => {
  for (let line = Math.max(0, fromLine); line < lines.length; line += 1) {
    const current = lines[line];
    const column = current ? firstTextColumn(current) : null;
    if (column !== null) return { line, column };
  }
  return null;
};

const textOf = (lines: readonly RenderedLine[], line: number): string => {
  const current = lines[line];
  return current ? lineText(current) : '';
};

/** The last column a cursor may sit on: the start of the last character. */
const lastColumn = (text: string): number => {
  if (text.length === 0) return 0;
  const column = text.length - 1;
  return isLowSurrogate(text, column) ? column - 1 : column;
};

/** A position that exists in `lines` (after a reload or a resize moved things). */
export const clampPosition = (lines: readonly RenderedLine[], at: Position): Position => {
  const line = Math.max(0, Math.min(at.line, lines.length - 1));
  const text = textOf(lines, line);
  const column = Math.max(0, Math.min(at.column, lastColumn(text)));
  return { line, column: isLowSurrogate(text, column) ? column - 1 : column };
};

const wordStarts = (text: string): number[] =>
  [...text.matchAll(/\S+/g)].map((match) => match.index);

/** Moves the head; motions never leave the rendered lines and keep astral characters whole. */
export const move = (lines: readonly RenderedLine[], head: Position, motion: Motion): Position => {
  const text = textOf(lines, head.line);
  switch (motion) {
    case 'left': {
      if (head.column === 0) return head;
      const column = head.column - 1;
      return { ...head, column: isLowSurrogate(text, column) ? column - 1 : column };
    }
    case 'right': {
      const column = head.column + charLengthAt(text, head.column);
      return column > lastColumn(text) ? head : { ...head, column };
    }
    case 'up':
    case 'down': {
      const line = head.line + (motion === 'up' ? -1 : 1);
      if (line < 0 || line >= lines.length) return head;
      const next = textOf(lines, line);
      const column = Math.min(head.column, lastColumn(next));
      return { line, column: isLowSurrogate(next, column) ? column - 1 : column };
    }
    case 'wordForward': {
      const here = wordStarts(text).find((start) => start > head.column);
      if (here !== undefined) return { ...head, column: here };
      for (let line = head.line + 1; line < lines.length; line += 1) {
        const [first] = wordStarts(textOf(lines, line));
        if (first !== undefined) return { line, column: first };
      }
      return head;
    }
    case 'lineStart': {
      const current = lines[head.line];
      return { ...head, column: (current && firstTextColumn(current)) ?? 0 };
    }
    case 'lineEnd':
      return { ...head, column: lastColumn(text) };
  }
};

/** The selected columns `[start, end)` of line `index`, or `null` when it is outside. */
/** The anchor and head alone; a bare cursor is a one-character range. */
export type Range = Pick<Selection, 'anchor' | 'head'>;

export const selectedColumns = (
  selection: Range,
  index: number,
  text: string,
): readonly [number, number] | null => {
  const [from, to] =
    comparePositions(selection.anchor, selection.head) <= 0
      ? [selection.anchor, selection.head]
      : [selection.head, selection.anchor];
  if (index < from.line || index > to.line) return null;
  const start = index === from.line ? from.column : 0;
  const end = index === to.line ? to.column + charLengthAt(text, to.column) : text.length;
  return [start, Math.max(start, end)];
};

export interface Piece {
  readonly span: Span;
  readonly selected: boolean;
}

/** Splits a line's spans at the selection boundaries so each piece is wholly in or out. */
export const highlight = (
  line: RenderedLine,
  index: number,
  selection: Range | undefined,
): Piece[] => {
  const range = selection ? selectedColumns(selection, index, lineText(line)) : null;
  if (!range) return line.spans.map((span) => ({ span, selected: false }));
  const [start, end] = range;
  const pieces: Piece[] = [];
  let column = 0;
  for (const span of line.spans) {
    const spanEnd = column + span.text.length;
    const cuts = [column, start, end, spanEnd]
      .filter((cut) => cut >= column && cut <= spanEnd)
      .sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i += 1) {
      const [a, b] = [cuts[i] ?? column, cuts[i + 1] ?? column];
      if (a === b) continue;
      const text = span.text.slice(a - column, b - column);
      const source = span.source && {
        start: span.source.start + (a - column),
        end: span.source.start + (b - column),
      };
      pieces.push({
        span: { ...span, text, ...(source && { source }) },
        selected: a >= start && b <= end,
      });
    }
    column = spanEnd;
  }
  return pieces;
};
