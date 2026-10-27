import { describe, expect, it } from 'vitest';
import type { RenderedLine } from '../../domain/text/rendered.js';
import {
  firstTextPosition,
  highlight,
  move,
  selectedColumns,
  type Selection,
} from './selection.js';

const src = (text: string, start: number) => ({
  text,
  source: { start, end: start + text.length },
});
const lines: RenderedLine[] = [
  { spans: [{ text: '# ', style: { dim: true } }, src('Title', 2)] },
  { spans: [] },
  { spans: [{ text: '- ', style: { dim: true } }, src('one 😀 two', 10)] },
  { spans: [src('three', 30), { text: 'ref', reference: 0 }, src(' four', 37)] },
];

describe('selection motions', () => {
  it('starts on the first selectable character at or after a line', () => {
    expect(firstTextPosition(lines, 0)).toEqual({ line: 0, column: 2 });
    expect(firstTextPosition(lines, 1)).toEqual({ line: 2, column: 2 });
    expect(firstTextPosition(lines, 4)).toBeNull();
  });

  it('moves by character, keeping emoji whole and staying on the line', () => {
    const at = { line: 2, column: 6 }; // on "😀"
    expect(move(lines, at, 'right')).toEqual({ line: 2, column: 8 });
    expect(move(lines, { line: 2, column: 8 }, 'left')).toEqual({ line: 2, column: 6 });
    expect(move(lines, { line: 2, column: 6 }, 'left')).toEqual({ line: 2, column: 5 });
    expect(move(lines, { line: 2, column: 0 }, 'left')).toEqual({ line: 2, column: 0 });
    expect(move(lines, { line: 2, column: 11 }, 'right')).toEqual({ line: 2, column: 11 });
  });

  it('moves between lines clamping the column and snapping off surrogate halves', () => {
    expect(move(lines, { line: 0, column: 6 }, 'down')).toEqual({ line: 1, column: 0 });
    expect(move(lines, { line: 3, column: 7 }, 'up')).toEqual({ line: 2, column: 6 });
    expect(move(lines, { line: 0, column: 0 }, 'up')).toEqual({ line: 0, column: 0 });
    expect(move(lines, { line: 3, column: 0 }, 'down')).toEqual({ line: 3, column: 0 });
  });

  it('moves by word across lines and to line ends', () => {
    expect(move(lines, { line: 0, column: 2 }, 'wordForward')).toEqual({ line: 2, column: 0 });
    expect(move(lines, { line: 2, column: 2 }, 'wordForward')).toEqual({ line: 2, column: 6 });
    expect(move(lines, { line: 2, column: 7 }, 'lineStart')).toEqual({ line: 2, column: 2 });
    expect(move(lines, { line: 2, column: 2 }, 'lineEnd')).toEqual({ line: 2, column: 11 });
  });

  it('highlights the inclusive range across lines and splits spans at its edges', () => {
    const selection: Selection = {
      anchor: { line: 3, column: 1 },
      head: { line: 2, column: 6 },
      version: 'v',
    };
    expect(selectedColumns(selection, 2, 'one 😀 two')).toEqual([6, 10]);
    expect(selectedColumns(selection, 3, 'threeref four')).toEqual([0, 2]);
    expect(selectedColumns(selection, 1, '')).toBeNull();
    expect(
      highlight(lines[3] ?? { spans: [] }, 3, selection).map((p) => [p.span.text, p.selected]),
    ).toEqual([
      ['th', true],
      ['ree', false],
      ['ref', false],
      [' four', false],
    ]);
    const pieces = highlight(lines[2] ?? { spans: [] }, 2, selection);
    expect(pieces.map((p) => [p.span.text, p.selected])).toEqual([
      ['- ', false],
      ['one ', false],
      ['😀 two', true],
    ]);
    expect(pieces[2]?.span.source).toEqual({ start: 14, end: 20 });
    expect(highlight(lines[0] ?? { spans: [] }, 0, undefined).every((p) => !p.selected)).toBe(true);
  });
});
