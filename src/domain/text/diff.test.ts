import { describe, expect, it } from 'vitest';
import { changedLines, lineNumberAt, unifiedDiff } from './diff.js';

describe('unifiedDiff', () => {
  it('is empty for identical text and shows hunks with three lines of context', () => {
    expect(unifiedDiff('a\n', 'a\n', 'x.md')).toBe('');
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n') + '\n';
    const after = before.replace('5\n', '5\nfive-and-a-half\n');
    expect(unifiedDiff(before, after, 'x.md')).toBe(
      [
        '--- a/x.md',
        '+++ b/x.md',
        '@@ -3,6 +3,7 @@',
        ' 3',
        ' 4',
        ' 5',
        '+five-and-a-half',
        ' 6',
        ' 7',
        ' 8',
        '',
      ].join('\n'),
    );
  });

  it('separates distant changes into hunks and flags a missing final newline', () => {
    const lines = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const before = lines.join('\n') + '\n';
    const after = before.replace('2\n', 'two\n').replace('20\n', '20');
    const diff = unifiedDiff(before, after, 'n.md');
    expect(diff).toContain('@@ -1,5 +1,5 @@\n 1\n-2\n+two\n 3\n');
    expect(diff).toContain(
      '@@ -17,4 +17,4 @@\n 17\n 18\n 19\n-20\n+20\n\\ No newline at end of file\n',
    );
    expect(unifiedDiff('', 'new\n', 'e.md')).toBe(
      '--- a/e.md\n+++ b/e.md\n@@ -1,0 +1,1 @@\n+new\n',
    );
  });
});

describe('changedLines', () => {
  it('numbers added lines in the new text and marks where deletions happened', () => {
    const before = 'a\nb\nc\nd\n';
    const after = 'a\nB\nc\nnew\nd\n';
    const changes = changedLines(before, after);
    expect([...changes.added]).toEqual([2, 4]);
    expect([...changes.deletedBefore]).toEqual([2]); // "b" went where "B" now is
    const gone = changedLines('a\nb\nc\n', 'a\nc\n');
    expect([...gone.added]).toEqual([]);
    expect([...gone.deletedBefore]).toEqual([2]); // "c" follows the hole
    expect(changedLines('x\n', 'x\n')).toEqual({ added: new Set(), deletedBefore: new Set() });
  });
});

describe('lineNumberAt', () => {
  it('counts newlines before the offset', () => {
    expect(lineNumberAt('a\nb\nc', 0)).toBe(1);
    expect(lineNumberAt('a\nb\nc', 2)).toBe(2);
    expect(lineNumberAt('a\nb\nc', 4)).toBe(3);
    expect(lineNumberAt('a\n', 99)).toBe(2);
  });
});
