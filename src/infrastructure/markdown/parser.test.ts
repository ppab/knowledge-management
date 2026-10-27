import { describe, expect, it } from 'vitest';
import { createMarkdownParser } from './parser.js';

const parser = createMarkdownParser();

describe('markdown parser', () => {
  it('finds references only in prose, with offsets relative to the full source', () => {
    const front = '---\nid: X\n---\n';
    const body = [
      '# Title',
      '',
      'Prose [[A1]] and `code [[C1]]` and [[B1|label]].',
      '',
      '```',
      '[[F1]]',
      '```',
      '',
      '<https://x.test/[[U1]]> and [label [[L1]]](https://x.test) and www.x.test/[[W1]]',
      '',
      '> quoted [[Q1]]',
      '',
    ].join('\n');
    const source = front + body;
    const parsed = parser.parse(source, front.length);

    expect(parsed.references.map((r) => r.target)).toEqual(['A1', 'B1', 'Q1']);
    for (const ref of parsed.references) {
      expect(source.slice(ref.range.start, ref.range.end)).toMatch(/^\[\[.*\]\]$/);
    }
    expect(parsed.references[1]).toMatchObject({ label: 'label' });
  });

  it('reports headings with depth, plain text and line ranges', () => {
    const source = '## Design *notes*\n\ntext\n\nSetext\n======\n';
    const parsed = parser.parse(source, 0);
    expect(parsed.headings).toEqual([
      { depth: 2, text: 'Design notes', range: { start: 0, end: 17 } },
      { depth: 1, text: 'Setext', range: { start: 25, end: 38 } },
    ]);
  });

  it('ignores heading-like lines inside fences and code, and tolerates odd whitespace', () => {
    const source = '```\n# not a heading\n```\n\n    # indented code\n\n#  Real   \n\n## Last';
    expect(parser.parse(source, 0).headings).toEqual([
      { depth: 1, text: 'Real', range: { start: 46, end: 56 } },
      { depth: 2, text: 'Last', range: { start: 58, end: 65 } },
    ]);
  });

  it('keeps references exact when the text node contains escapes and entities', () => {
    const source = 'a \\* b &amp; [[R1]] c';
    const parsed = parser.parse(source, 0);
    const ref = parsed.references[0]!;
    expect(source.slice(ref.range.start, ref.range.end)).toBe('[[R1]]');
  });

  it('exposes text spans that map back to the source', () => {
    const source = 'one *two* three';
    const parsed = parser.parse(source, 0);
    expect(parsed.textSpans.map((s) => source.slice(s.start, s.end))).toEqual([
      'one ',
      'two',
      ' three',
    ]);
  });
});
