import { describe, expect, it } from 'vitest';
import type { Heading } from '../note/note.js';
import { unwrap } from '../result.js';
import { locateInsertion, parseInsertionLocation, type DocumentLayout } from './insertion.js';
import { applyEdits } from './text-edit.js';

/** Minimal ATX heading scanner so these tests stay independent of the Markdown adapter. */
const layout = (source: string, bodyStart = 0): DocumentLayout => {
  const headings: Heading[] = [];
  for (const match of source.slice(bodyStart).matchAll(/^(#{1,6}) (.*)$/gm)) {
    headings.push({
      depth: match[1]!.length as Heading['depth'],
      text: match[2]!,
      range: { start: bodyStart + match.index, end: bodyStart + match.index + match[0].length },
    });
  }
  return { source, bodyStart, headings };
};

const insert = (source: string, at: string, block = 'NEW', bodyStart = 0) =>
  unwrap(
    applyEdits(source, [
      unwrap(locateInsertion(layout(source, bodyStart), unwrap(parseInsertionLocation(at)), block))
        .edit,
    ]),
  );

describe('parseInsertionLocation', () => {
  it('accepts end, heading:<text> and references', () => {
    expect(unwrap(parseInsertionLocation('end'))).toEqual({ kind: 'end' });
    expect(unwrap(parseInsertionLocation('heading: Design '))).toEqual({
      kind: 'heading',
      text: 'Design',
    });
    expect(unwrap(parseInsertionLocation('references'))).toEqual({ kind: 'references' });
    expect(parseInsertionLocation('heading:')).toMatchObject({ ok: false });
    expect(parseInsertionLocation('top')).toMatchObject({ ok: false, error: { code: 'USAGE' } });
  });
});

describe('locateInsertion', () => {
  it('appends at the end as a separate paragraph, adding a final newline only when needed', () => {
    expect(insert('a\n', 'end')).toBe('a\n\nNEW\n');
    expect(insert('a', 'end')).toBe('a\n\nNEW\n');
    expect(insert('a\n\n\n', 'end')).toBe('a\n\nNEW\n\n\n');
    expect(insert('', 'end')).toBe('NEW\n');
    const fm = '---\nid: x\n---\n';
    expect(insert(fm, 'end', 'NEW', fm.length)).toBe(`${fm}\nNEW\n`);
    expect(insert(`${fm}\nBody\n`, 'end', 'NEW', fm.length)).toBe(`${fm}\nBody\n\nNEW\n`);
  });

  it('inserts under a heading before the next heading of equal or higher depth', () => {
    const doc = '# T\n\n## Design\n\ntext\n\n### Sub\n\nmore\n\n## Next\n\nend\n';
    expect(insert(doc, 'heading:design')).toBe(
      '# T\n\n## Design\n\ntext\n\n### Sub\n\nmore\n\nNEW\n\n## Next\n\nend\n',
    );
    expect(insert(doc, 'heading:Sub')).toBe(
      '# T\n\n## Design\n\ntext\n\n### Sub\n\nmore\n\nNEW\n\n## Next\n\nend\n',
    );
    expect(insert(doc, 'heading:Next')).toBe(doc.replace('end\n', 'end\n\nNEW\n'));
    expect(insert('## Empty\n## After\n', 'heading:Empty')).toBe('## Empty\n\nNEW\n## After\n');
    expect(insert('## Last', 'heading:Last')).toBe('## Last\n\nNEW\n');
  });

  it('refuses unknown or ambiguous headings', () => {
    const base = layout('## A\n\n## B\n\n## A\n');
    expect(locateInsertion(base, { kind: 'heading', text: 'Zzz' }, 'x')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { headings: ['A', 'B', 'A'] } },
    });
    expect(locateInsertion(base, { kind: 'heading', text: 'a' }, 'x')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });

  it('uses an existing References section or creates one at the end', () => {
    expect(insert('Intro\n\n## references\n\n[[A]]\n\n## Z\n', 'references')).toBe(
      'Intro\n\n## references\n\n[[A]]\n\nNEW\n\n## Z\n',
    );
    expect(insert('Intro\n', 'references')).toBe('Intro\n\n## References\n\nNEW\n');
    const created = unwrap(locateInsertion(layout('Intro\n'), { kind: 'references' }, 'x'));
    expect(created.addsHeadings).toEqual([{ depth: 2, text: 'References' }]);
    const reused = unwrap(locateInsertion(layout('## References\n'), { kind: 'references' }, 'x'));
    expect(reused.addsHeadings).toEqual([]);
  });
});
