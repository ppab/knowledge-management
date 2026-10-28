import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listReferences } from './references.js';
import { backlinks } from './references.js';
import { removeReference } from './remove-reference.js';

const B = '---\nid: B\ntitle: Beta\n---\n';

describe('removeReference', () => {
  const rangeOf = (source: string, needle: string) => {
    const start = source.indexOf(needle);
    return { start, end: start + needle.length };
  };

  it('unlinks a labelled reference, leaving the label as prose', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\nSee [[B|the beta note]] for details.\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', B);
    const removed = unwrap(
      await removeReference(f.deps, f.scope, {
        source: 'A',
        range: rangeOf(A, '[[B|the beta note]]'),
      }),
    );
    expect(removed.kind).toBe('unlinked');
    expect(f.fs.files.get('a.md')).toBe(A.replace('[[B|the beta note]]', 'the beta note'));
    expect(unwrap(await listReferences(f.deps, f.scope, 'A')).references).toEqual([]);
    expect(unwrap(await backlinks(f.deps, f.scope, 'B')).backlinks).toEqual([]);
  });

  it('deletes a bare reference with one adjacent space, keeping the prose tidy', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\nintro [[B]] text\n\nend [[B]]\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', B);
    unwrap(await removeReference(f.deps, f.scope, { source: 'A', range: rangeOf(A, '[[B]]') }));
    expect(f.fs.files.get('a.md')).toBe('---\nid: A\n---\n\nintro text\n\nend [[B]]\n');
    const after = f.fs.files.get('a.md') ?? '';
    unwrap(await removeReference(f.deps, f.scope, { source: 'A', range: rangeOf(after, '[[B]]') }));
    expect(f.fs.files.get('a.md')).toBe('---\nid: A\n---\n\nintro text\n\nend\n');
  });

  it('drops the whole line when the reference stood alone in a references list', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\nBody.\n\n## References\n\n- [[B]]\n- [[C|See C]]\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', B);
    f.fs.files.set('c.md', '---\nid: C\ntitle: Gamma\n---\n');
    const removed = unwrap(
      await removeReference(f.deps, f.scope, { source: 'A', range: rangeOf(A, '[[B]]') }),
    );
    expect(removed.kind).toBe('deleted');
    expect(f.fs.files.get('a.md')).toBe(
      '---\nid: A\n---\n\nBody.\n\n## References\n\n- [[C|See C]]\n',
    );
  });

  it('refuses a stale version or a range that is not a reference, writing nothing', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\nSee [[B]].\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', B);
    const range = rangeOf(A, '[[B]]');
    expect(
      await removeReference(f.deps, f.scope, { source: 'A', range, expectedVersion: 'stale' }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(
      await removeReference(f.deps, f.scope, { source: 'A', range: { start: 0, end: 5 } }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const dry = unwrap(
      await removeReference(f.deps, f.scope, { source: 'A', range, dryRun: true }),
    );
    expect(dry.written).toBe(false);
    expect(dry.diff).toContain('-See [[B]].');
    expect(f.fs.writes).toEqual([]);
  });
});
