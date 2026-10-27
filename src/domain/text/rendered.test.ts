import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import {
  charLengthAt,
  referenceAt,
  referencePositions,
  selectedRange,
  sourceOffsetAt,
  type RenderedLine,
} from './rendered.js';

// "- ab 😀c" rendered from the source "ab 😀c" that starts at offset 10, bullet synthetic.
const SOURCE_START = 10;
const line: RenderedLine = {
  spans: [
    { text: '- ', style: { dim: true } },
    { text: 'ab ', source: { start: SOURCE_START, end: SOURCE_START + 3 } },
    { text: 'ref', reference: 0 },
    { text: '😀c', source: { start: SOURCE_START + 3, end: SOURCE_START + 6 } },
  ],
};
const blank: RenderedLine = { spans: [] };

describe('rendered selection mapping', () => {
  it('measures astral characters as two units', () => {
    expect(charLengthAt('a😀', 0)).toBe(1);
    expect(charLengthAt('a😀', 1)).toBe(2);
    expect(charLengthAt('a', 1)).toBe(0);
  });

  it('maps an ordered or reversed selection to an inclusive source range', () => {
    const forward = unwrap(selectedRange([line], { line: 0, column: 2 }, { line: 0, column: 3 }));
    expect(forward).toEqual({ start: SOURCE_START, end: SOURCE_START + 2 });
    const backward = unwrap(selectedRange([line], { line: 0, column: 3 }, { line: 0, column: 2 }));
    expect(backward).toEqual(forward);
    // The head on the emoji selects both of its units.
    const emoji = unwrap(selectedRange([line], { line: 0, column: 8 }, { line: 0, column: 8 }));
    expect(emoji).toEqual({ start: SOURCE_START + 3, end: SOURCE_START + 5 });
  });

  it('spans lines', () => {
    const second: RenderedLine = { spans: [{ text: 'xy', source: { start: 20, end: 22 } }] };
    expect(
      unwrap(selectedRange([line, blank, second], { line: 0, column: 10 }, { line: 2, column: 1 })),
    ).toEqual({ start: SOURCE_START + 5, end: 22 });
  });

  it('refuses ends on synthetic text, blank lines or past the end', () => {
    for (const [anchor, head] of [
      [
        { line: 0, column: 0 },
        { line: 0, column: 3 },
      ], // bullet
      [
        { line: 0, column: 2 },
        { line: 0, column: 6 },
      ], // reference label
      [
        { line: 0, column: 2 },
        { line: 1, column: 0 },
      ], // blank line
      [
        { line: 0, column: 2 },
        { line: 5, column: 0 },
      ], // no such line
    ] as const) {
      expect(selectedRange([line, blank], anchor, head)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', message: 'Selection must start and end on note text' },
      });
    }
    expect(sourceOffsetAt(blank, 0)).toBeNull();
  });

  it('finds references under a column and lists where they start', () => {
    expect(referenceAt(line, 5)).toBe(0);
    expect(referenceAt(line, 4)).toBeNull();
    expect(referenceAt(line, 8)).toBeNull();
    expect(referenceAt(blank, 0)).toBeNull();
    const second: RenderedLine = { spans: [{ text: 'x', reference: 1 }] };
    expect(referencePositions([line, blank, second])).toEqual([
      { reference: 0, line: 0, column: 5 },
      { reference: 1, line: 2, column: 0 },
    ]);
  });
});
