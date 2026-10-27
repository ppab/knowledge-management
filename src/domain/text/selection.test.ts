import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { wrapSelection } from './selection.js';
import { applyEdits } from './text-edit.js';

describe('wrapSelection', () => {
  const source = '# Title\n\nSome *bold* words and [[X]] here.\n';
  const layout = {
    source,
    headings: [{ depth: 1 as const, text: 'Title', range: { start: 0, end: 7 } }],
    // "Some ", "bold", " words and [[X]] here."
    textSpans: [
      { start: 9, end: 14 },
      { start: 15, end: 19 },
      { start: 20, end: source.length - 1 },
    ],
  };
  const wrap = (t: string) => `<${t}>`;

  it('wraps text inside one prose span', () => {
    const edit = unwrap(wrapSelection(layout, { start: 21, end: 26 }, wrap));
    expect(unwrap(applyEdits(source, [edit]))).toBe(source.replace('words', '<words>'));
  });

  it('refuses empty, span-crossing, heading and reference-containing selections', () => {
    const refuse = (start: number, end: number, message: string) => {
      expect(wrapSelection(layout, { start, end }, wrap)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', message: expect.stringContaining(message) as string },
      });
    };
    refuse(10, 10, 'empty');
    refuse(9, 19, 'single run');
    refuse(2, 7, 'single run');
    refuse(27, 36, 'already contains');
  });

  it('refuses heading text even when it is a plain span', () => {
    const heading = {
      source: '# Hi\n',
      headings: [{ depth: 1 as const, text: 'Hi', range: { start: 0, end: 4 } }],
      textSpans: [{ start: 2, end: 4 }],
    };
    expect(wrapSelection(heading, { start: 2, end: 4 }, wrap)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Heading') as string },
    });
  });
});
