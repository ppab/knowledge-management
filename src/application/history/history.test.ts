import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { diffRevisions, listRevisions, readRevision, revisionStatus } from './history.js';

const v1 = '---\nid: N1\ntitle: Note\n---\n\nfirst\n';
const v2 = '---\nid: N1\ntitle: Note\n---\n\nsecond\n';
const v3 = '---\nid: N1\ntitle: Note\n---\n\nthird\n';

describe('history', () => {
  it('reports unversioned vaults and unrecorded files as outcomes, not errors', async () => {
    const f = fixture();
    f.fs.files.set('n.md', v1);
    expect(unwrap(await revisionStatus(f.deps, f.scope, { query: 'N1' })).status).toEqual({
      kind: 'unversioned',
    });
    const unversioned = unwrap(await listRevisions(f.deps, f.scope, { query: 'N1' }));
    expect(unversioned.revisions).toEqual([]);
    expect(unversioned.entry.path).toBe('n.md');

    f.revisions.enable('/vault');
    expect(unwrap(await listRevisions(f.deps, f.scope, { query: 'N1' })).status).toEqual({
      kind: 'unrecorded',
    });
    const diff = await diffRevisions(f.deps, f.scope, { query: 'N1' });
    expect(diff).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    if (!diff.ok) expect(diff.error.message).toContain('no recorded revisions yet');
  });

  it('lists newest first and tells clean from modified', async () => {
    const f = fixture();
    f.revisions.enable('/vault');
    f.fs.files.set('n.md', v2);
    f.revisions.seed('/vault', 'n.md', v1, 'first');
    const last = f.revisions.seed('/vault', 'n.md', v2, 'second');

    const history = unwrap(await listRevisions(f.deps, f.scope, { query: 'N1' }));
    expect(history.revisions.map((r) => r.summary)).toEqual(['second', 'first']);
    expect(history.status).toEqual({ kind: 'clean', last });

    f.fs.files.set('n.md', v3);
    expect(unwrap(await revisionStatus(f.deps, f.scope, { query: 'N1' })).status).toEqual({
      kind: 'modified',
      last,
    });
  });

  it('reads historical content by id or prefix without indexing it', async () => {
    const f = fixture();
    f.revisions.enable('/vault');
    f.fs.files.set('n.md', v2);
    const first = f.revisions.seed('/vault', 'n.md', v1, 'first');
    f.revisions.seed('/vault', 'n.md', v2, 'second');

    const old = unwrap(await readRevision(f.deps, f.scope, { query: 'N1' }, first.id.slice(0, 7)));
    expect(old.entry.source).toBe(v1);
    expect(old.entry.title).toBe('Note');
    expect(old.revision).toEqual(first);
    expect(old.current.source).toBe(v2);
    // The index still describes the working file.
    expect(unwrap(await listRevisions(f.deps, f.scope, { query: 'N1' })).entry.source).toBe(v2);

    expect(await readRevision(f.deps, f.scope, { query: 'N1' }, 'rev')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await readRevision(f.deps, f.scope, { query: 'N1' }, 'rev00')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });

  it('diffs last → working by default, revision → revision on request', async () => {
    const f = fixture();
    f.revisions.enable('/vault');
    f.fs.files.set('n.md', v3);
    const first = f.revisions.seed('/vault', 'n.md', v1, 'first');
    const second = f.revisions.seed('/vault', 'n.md', v2, 'second');

    const working = unwrap(await diffRevisions(f.deps, f.scope, { query: 'N1' }));
    expect(working.from).toEqual(second);
    expect(working.to).toBe('working');
    expect(working.patch).toContain('-second\n+third\n');

    const between = unwrap(
      await diffRevisions(f.deps, f.scope, { query: 'N1' }, { from: first.id, to: second.id }),
    );
    expect(between.patch).toContain('-first\n+second\n');

    // `--to` alone compares against the revision before it.
    const implicit = unwrap(
      await diffRevisions(f.deps, f.scope, { query: 'N1' }, { to: second.id }),
    );
    expect(implicit.from).toEqual(first);
    const same = unwrap(
      await diffRevisions(f.deps, f.scope, { query: 'N1' }, { from: first.id, to: first.id }),
    );
    expect(same.patch).toBe('');
    expect(await diffRevisions(f.deps, f.scope, { query: 'N1' }, { to: first.id })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('addresses unidentified files by vault and path', async () => {
    const f = fixture();
    f.revisions.enable('/vault');
    f.fs.files.set('plain.md', '# Plain\n\nnew text\n');
    f.revisions.seed('/vault', 'plain.md', '# Plain\n\nold text\n', 'first');
    const diff = unwrap(
      await diffRevisions(f.deps, f.scope, { vault: 'monitor', path: 'plain.md' }),
    );
    expect(diff.patch).toContain('-old text\n+new text\n');
  });
});
