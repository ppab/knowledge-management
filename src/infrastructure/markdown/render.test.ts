import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../../domain/note/frontmatter.js';
import * as rendered from '../../domain/text/rendered.js';
import { lineText, sourceOffsetAt, type Position } from '../../domain/text/rendered.js';
import { unwrap } from '../../domain/result.js';
import { wrapSelection } from '../../domain/text/selection.js';
import { applyEdits } from '../../domain/text/text-edit.js';
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

describe('selection mapping over rendered lines', () => {
  const { selectedRange } = rendered;
  /** Selects between two rendered positions and wraps the mapped source in `<…>`. */
  const wrapped = (source: string, width: number, anchor: Position, head: Position) => {
    const lines = parser.render(source, 0, { width });
    const range = selectedRange(lines, anchor, head);
    if (!range.ok) return range;
    const parsed = parser.parse(source, 0);
    const edit = wrapSelection(
      { source, textSpans: parsed.textSpans, headings: parsed.headings },
      range.value,
      (text) => `<${text}>`,
    );
    return edit.ok ? applyEdits(source, [edit.value]) : edit;
  };
  const at = (line: number, column: number): Position => ({ line, column });

  it('maps plain, wrapped, unicode and emoji selections to the right source bytes', () => {
    expect(unwrap(wrapped('alpha beta gamma\n', 80, at(0, 6), at(0, 9)))).toBe(
      'alpha <beta> gamma\n',
    );
    // Width 10 wraps into "one two" / "three four" / "five six"; the dropped space is still selected.
    const lines = parser.render('one two three four five six\n', 0, { width: 10 });
    expect(lines.map(lineText)).toEqual(['one two', 'three four', 'five six']);
    expect(unwrap(wrapped('one two three four five six\n', 10, at(0, 4), at(1, 4)))).toBe(
      'one <two three> four five six\n',
    );
    expect(unwrap(wrapped('naïve café here\n', 80, at(0, 9), at(0, 6)))).toBe(
      'naïve <café> here\n',
    );
    expect(unwrap(wrapped('go 😀 now\n', 80, at(0, 3), at(0, 3)))).toBe('go <😀> now\n');
    expect(unwrap(wrapped('go 😀 now\n', 80, at(0, 0), at(0, 3)))).toBe('<go 😀> now\n');
  });

  it('rejects ends on synthetic text and ranges that cross formatting', () => {
    const invalid = (source: string, anchor: Position, head: Position, message: string) => {
      expect(wrapped(source, 80, anchor, head)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', message: expect.stringContaining(message) as string },
      });
    };
    invalid('- item here\n', at(0, 0), at(0, 4), 'note text'); // the bullet
    invalid('see [[X|label]] here\n', at(0, 5), at(0, 7), 'note text'); // a reference label
    invalid('item *em* x\n', at(0, 2), at(0, 6), 'crosses formatting');
    invalid('a `code` b\n', at(0, 0), at(0, 3), 'crosses formatting');
    invalid('# Heading\n', at(0, 2), at(0, 4), 'Heading text');
  });
});
