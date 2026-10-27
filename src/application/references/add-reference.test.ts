import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { addReference, checkInsertionPoint } from './add-reference.js';
import { backlinks } from './references.js';

const A =
  '---\nid: A\ntitle: Alpha\n---\n\n# Alpha\n\nIntro.\n\n## Design\n\nText.\n\n## Notes\n\nEnd.\n';

describe('addReference at a cursor', () => {
  it('writes the canonical id inline next to the word, or refuses outside prose', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\n# Head\n\nintro *em* text\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('d.md', '---\nid: D\ntitle: Design doc\naliases: [dd]\n---\n');
    const at = (needle: string, side: 'before' | 'after') =>
      addReference(f.deps, f.scope, {
        source: 'A',
        target: 'dd',
        at: { kind: 'at', offset: A.indexOf(needle), side },
      });
    unwrap(await at('text', 'before'));
    expect(f.fs.files.get('a.md')).toBe(A.replace('*em* text', '*em* [[D]] text'));
    f.fs.files.set('a.md', A);
    unwrap(await at('intro', 'after'));
    expect(f.fs.files.get('a.md')).toBe(A.replace('intro *em*', 'intro [[D]] *em*'));
    f.fs.files.set('a.md', A);
    // Emphasis text is a prose run of its own; the markers and headings are not prose.
    unwrap(await at('em*', 'before'));
    expect(f.fs.files.get('a.md')).toBe(A.replace('*em*', '*[[D]] em*'));
    f.fs.files.set('a.md', A);
    const check = (needle: string, side: 'before' | 'after', expectedVersion?: string) =>
      checkInsertionPoint(f.deps, f.scope, {
        source: 'A',
        at: { kind: 'at', offset: A.indexOf(needle), side },
        ...(expectedVersion !== undefined && { expectedVersion }),
      });
    expect(await at('*em', 'before')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await check('*em', 'before')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: 'The cursor must be on note text' },
    });
    expect(await check('Head', 'after')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: 'Heading text cannot hold a reference' },
    });
    expect(await check('text', 'after', 'stale')).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(await check('text', 'after')).toEqual({ ok: true, value: undefined });
    expect(f.fs.files.get('a.md')).toBe(A);
  });
});

describe('addReference', () => {
  it('writes the canonical id when the target was given by alias, at the requested place', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', '---\nid: B\ntitle: Beta\naliases: [bee]\n---\n');

    unwrap(
      await addReference(f.deps, f.scope, {
        source: 'alpha',
        target: 'bee',
        at: { kind: 'heading', text: 'Design' },
        label: 'see Beta',
      }),
    );
    expect(f.fs.files.get('a.md')).toBe(
      A.replace('Text.\n\n## Notes', 'Text.\n\n[[B|see Beta]]\n\n## Notes'),
    );
    expect(unwrap(await backlinks(f.deps, f.scope, 'B')).backlinks.map((b) => b.label)).toEqual([
      'see Beta',
    ]);
  });

  it('creates a References section once, then appends to it', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', '---\nid: B\n---\n');
    f.fs.files.set('c.md', '---\nid: C\n---\n');
    unwrap(
      await addReference(f.deps, f.scope, { source: 'A', target: 'B', at: { kind: 'references' } }),
    );
    unwrap(
      await addReference(f.deps, f.scope, { source: 'A', target: 'C', at: { kind: 'references' } }),
    );
    expect(f.fs.files.get('a.md')).toBe(A + '\n## References\n\n[[B]]\n\n[[C]]\n');
  });

  it('previews with --dry-run and fails cleanly on unknown notes or headings', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', '---\nid: B\n---\n');
    const preview = unwrap(
      await addReference(f.deps, f.scope, { source: 'A', target: 'B', dryRun: true }),
    );
    expect(preview.diff).toContain('+[[B]]');
    expect(f.fs.writes).toEqual([]);
    expect(await addReference(f.deps, f.scope, { source: 'A', target: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await addReference(f.deps, f.scope, {
        source: 'A',
        target: 'B',
        at: { kind: 'heading', text: 'Nope' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(f.fs.writes).toEqual([]);
  });
});
