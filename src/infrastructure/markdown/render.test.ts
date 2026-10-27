import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../../domain/note/frontmatter.js';
import { lineText, sourceOffsetAt } from '../../domain/text/rendered.js';
import { createMarkdownParser } from './parser.js';

const parser = createMarkdownParser();
const fixturesDir = resolve(import.meta.dirname, '../../../test/fixtures/render');

const loadFixtures = async () => {
  const names = (await readdir(fixturesDir)).filter((n) => n.endsWith('.md')).sort();
  return Promise.all(
    names.map(async (name) => {
      const source = await readFile(join(fixturesDir, name), 'utf8');
      const bodyStart = splitFrontmatter(source)?.blockRange.end ?? 0;
      return { name, source, bodyStart };
    }),
  );
};

const WIDTHS = [0, 20, 37, 80];

describe('markdown renderer', () => {
  it('maps every source-backed span to a slice equal to its text, at every width', async () => {
    for (const { source, bodyStart } of await loadFixtures()) {
      for (const width of WIDTHS) {
        const lines = parser.render(source, bodyStart, { width });
        for (const line of lines) {
          for (const span of line.spans) {
            if (!span.source) continue;
            expect(source.slice(span.source.start, span.source.end)).toBe(span.text);
            expect(span.source.start).toBeGreaterThanOrEqual(bodyStart);
          }
          if (width > 0) {
            // Only an unbreakable token (a reference label, a verbatim line) may exceed the width.
            const overflow = lineText(line).length > width;
            const unbreakable = line.spans.some(
              (s) => s.reference !== undefined || s.style?.code === true || s.text.length > width,
            );
            if (overflow) expect(unbreakable).toBe(true);
          }
        }
      }
    }
  });

  it('numbers references in parse order and shows labels, titles or targets', async () => {
    const prose = (await loadFixtures()).find((f) => f.name === 'prose.md')!;
    const parsed = parser.parse(prose.source, prose.bodyStart);
    const lines = parser.render(prose.source, prose.bodyStart, {
      width: 80,
      referenceText: (ref, index) => (index === 0 ? 'Target One' : (ref.label ?? ref.target)),
    });
    const refs = lines.flatMap((l) => l.spans.filter((s) => s.reference !== undefined));
    expect(refs.map((s) => [s.reference, s.text])).toEqual([
      [0, 'Target One'],
      [1, 'the second target'],
      [2, 'TARGET3'],
      [3, 'quoted ref'],
    ]);
    expect(parsed.references.map((r) => r.target)).toEqual([
      'TARGET1',
      'TARGET2',
      'TARGET3',
      'TARGET4',
    ]);
    // Code never yields a reference span, even when it looks like one.
    expect(lines.map(lineText).join('\n')).toContain('const x = [[NOTREF]];');
  });

  it('renders structure with synthetic markers and keeps prose on the mapped spans', () => {
    const source = '# Title\n\n- a *b*\n  - c\n\n> q\n\nx  \ny\n';
    const lines = parser.render(source, 0, { width: 0 }).map(lineText);
    expect(lines).toEqual(['# Title', '', '- a b', '  - c', '', '> q', '', 'x', 'y']);
    const [heading] = parser.render(source, 0, { width: 0 });
    expect(heading?.spans).toEqual([
      { text: '# ', style: { dim: true } },
      { text: 'Title', source: { start: 2, end: 7 }, style: { bold: true, heading: 1 } },
    ]);
  });

  it('wraps at word boundaries and indents continuation lines under the bullet', () => {
    const source = '- one two three four five six\n';
    const lines = parser.render(source, 0, { width: 12 }).map(lineText);
    expect(lines).toEqual(['- one two', '  three four', '  five six']);
  });

  it('maps rendered columns back to source offsets', () => {
    const source = 'ab *cd* ef\n';
    const [line] = parser.render(source, 0, { width: 0 });
    expect(lineText(line!)).toBe('ab cd ef');
    expect(sourceOffsetAt(line!, 0)).toBe(0);
    expect(sourceOffsetAt(line!, 3)).toBe(4); // "c" sits after the "*"
    expect(sourceOffsetAt(line!, 8)).toBe(10); // end of the line → end of the last span
    expect(sourceOffsetAt(line!, 9)).toBeNull();
    const [bullet] = parser.render('- x', 0, { width: 0 });
    expect(sourceOffsetAt(bullet!, 0)).toBeNull(); // synthetic bullet
  });
});
