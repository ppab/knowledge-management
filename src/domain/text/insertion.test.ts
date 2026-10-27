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
  return { source, bodyStart, headings, textSpans: [] };
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

describe('locateInsertion at a cursor', () => {
  // "intro text" is one prose run; "*em* word" holds an emphasis node then " word".
  const source = '# Title\n\nintro text\n\n*em* word\n';
  const at = (offset: number, side: 'before' | 'after') => {
    const plan = locateInsertion(
      {
        ...layout(source),
        textSpans: [
          { start: 2, end: 7 },
          { start: 9, end: 19 },
          { start: 22, end: 24 },
          { start: 25, end: 30 },
        ],
      },
      { kind: 'at', offset, side },
      '[[X]]',
    );
    return plan.ok ? unwrap(applyEdits(source, [plan.value.edit])) : plan;
  };
  it('pads only the side that touches a word', () => {
    expect(at(15, 'before')).toBe(source.replace('intro text', 'intro [[X]] text'));
    expect(at(9, 'after')).toBe(source.replace('intro text', 'intro [[X]] text'));
    expect(at(16, 'after')).toBe(source.replace('intro text', 'intro text [[X]]'));
    expect(at(9, 'before')).toBe(source.replace('intro text', '[[X]] intro text'));
    expect(at(14, 'before')).toBe(source.replace('intro text', 'intro [[X]] text')); // on the space
    expect(at(11, 'before')).toBe(source.replace('intro text', 'in [[X]] tro text'));
    expect(at(27, 'after')).toBe(source.replace('*em* word', '*em* word [[X]]'));
  });
  it('refuses positions outside prose runs or inside a heading', () => {
    for (const [offset, message] of [
      [20, 'note text'], // the blank line
      [21, 'note text'], // the "*"
      [4, 'Heading text'],
    ] as const) {
      expect(at(offset, 'before')).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', message: expect.stringContaining(message) as string },
      });
    }
  });
});
