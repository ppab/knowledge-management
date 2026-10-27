import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listNotes } from '../notes/list-notes.js';
import { insertSnippet } from './insert-snippet.js';

const A =
  '---\nid: A\ntitle: Alpha\n---\n\n# Alpha\n\nIntro.\n\n## Log\n\n- old\n\n## Other\n\nx\n';

describe('insertSnippet', () => {
  it('renders built-ins and defaults, honours the snippet default location, allows headings it brings', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    f.snippets.set(
      'entry',
      '---\nsnippet:\n  at: "heading:Log"\n  variables:\n    mood: { default: fine }\n---\n### {{date}} by {{owner}}\n\nFeeling {{mood}} about {{title}} ({{id}}) in {{vault}}.\n\n',
    );
    unwrap(
      await insertSnippet(f.deps, f.scope, {
        note: 'A',
        snippet: 'entry',
        variables: { owner: 'me' },
      }),
    );
    expect(f.fs.files.get('a.md')).toBe(
      A.replace(
        '- old\n\n## Other',
        '- old\n\n### 2026-10-27 by me\n\nFeeling fine about Alpha (A) in monitor.\n\n## Other',
      ),
    );
  });

  it('fails on a missing variable before reading the note, and reports references it adds', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    f.snippets.set('needs', 'Hello {{who}} [[B]]\n');
    // Warm the index so the only file read left to observe would be the note itself.
    unwrap(await listNotes(f.deps, f.scope));
    const reads: string[] = [];
    const notes = f.deps.notes;
    const spied = {
      ...f.deps,
      notes: {
        ...notes,
        read: (root: string, path: string) => {
          reads.push(path);
          return notes.read(root, path);
        },
      },
    };
    expect(await insertSnippet(spied, f.scope, { note: 'A', snippet: 'needs' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { missing: ['who'] } },
    });
    expect(reads).toEqual([]);

    const out = unwrap(
      await insertSnippet(f.deps, f.scope, {
        note: 'A',
        snippet: 'needs',
        variables: { who: 'you' },
        at: { kind: 'end' },
      }),
    );
    expect(out.written).toBe(true);
    expect(f.fs.files.get('a.md')).toBe(A + '\nHello you [[B]]\n');
    expect(await insertSnippet(f.deps, f.scope, { note: 'A', snippet: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
