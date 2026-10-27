import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { addReference } from './add-reference.js';
import { backlinks } from './references.js';

const A =
  '---\nid: A\ntitle: Alpha\n---\n\n# Alpha\n\nIntro.\n\n## Design\n\nText.\n\n## Notes\n\nEnd.\n';

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
