import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { applyEdits, insertAt, replaceRange } from './text-edit.js';

const randomInt = (max: number) => Math.floor(Math.random() * (max + 1));

describe('applyEdits', () => {
  it('applies edits given in any order', () => {
    const edits = [replaceRange({ start: 6, end: 11 }, 'there'), insertAt(0, '> ')];
    expect(unwrap(applyEdits('hello world', edits))).toBe('> hello there');
  });

  it('rejects overlapping edits and out-of-bounds ranges', () => {
    const overlap = applyEdits('abcdef', [
      replaceRange({ start: 0, end: 3 }, ''),
      replaceRange({ start: 2, end: 4 }, ''),
    ]);
    expect(overlap.ok).toBe(false);
    expect(applyEdits('abc', [replaceRange({ start: 1, end: 9 }, '')]).ok).toBe(false);
  });

  it('allows an insert at the boundary of a replacement', () => {
    const edits = [replaceRange({ start: 0, end: 1 }, 'X'), insertAt(1, 'Y')];
    expect(unwrap(applyEdits('ab', edits))).toBe('XYb');
  });

  it('never changes bytes outside the edited ranges (property)', () => {
    for (let round = 0; round < 200; round++) {
      const source = Array.from({ length: randomInt(40) }, () =>
        String.fromCharCode(97 + randomInt(25)),
      ).join('');
      // Build non-overlapping ranges by walking left to right.
      const edits = [];
      let cursor = 0;
      while (cursor <= source.length && edits.length < 5) {
        const start = cursor + randomInt(Math.max(0, source.length - cursor));
        const end = start + randomInt(Math.max(0, source.length - start));
        edits.push(replaceRange({ start, end }, '#'.repeat(randomInt(3))));
        cursor = end + 1;
      }
      const result = unwrap(applyEdits(source, edits.reverse()));

      // Reconstruct expected output independently and compare the untouched segments.
      let expected = '';
      let last = 0;
      for (const e of [...edits].sort((a, b) => a.start - b.start)) {
        expected += source.slice(last, e.start) + e.replacement;
        last = e.end;
      }
      expected += source.slice(last);
      expect(result).toBe(expected);
    }
  });
});
