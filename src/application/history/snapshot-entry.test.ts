import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listRevisions } from './history.js';
import { snapshotEntry } from './snapshot-entry.js';

const v1 = '---\nid: N1\ntitle: Entry\n---\n\nfirst\n';
const v2 = '---\nid: N1\ntitle: Entry\n---\n\nsecond\n';

describe('snapshotEntry', () => {
  it('records exactly the requested note with the given or default message', async () => {
    const f = fixture();
    f.revisions.enable('/vault');
    f.fs.files.set('n.md', v1);
    f.fs.files.set('other.md', '---\nid: O1\ntitle: Other\n---\n');

    const first = unwrap(await snapshotEntry(f.deps, f.scope, { query: 'N1' }));
    expect(first.outcome).toMatchObject({
      kind: 'saved',
      revision: { summary: 'note: snapshot Entry' },
    });
    expect(f.revisions.recorded).toEqual([
      { root: '/vault', path: 'n.md', message: 'note: snapshot Entry' },
    ]);

    const unchanged = unwrap(
      await snapshotEntry(f.deps, f.scope, { query: 'N1' }, { message: 'x' }),
    );
    expect(unchanged.outcome).toMatchObject({
      kind: 'nothing-to-save',
      last: { summary: 'note: snapshot Entry' },
    });
    expect(f.revisions.recorded).toHaveLength(1);

    f.fs.files.set('n.md', v2);
    const second = unwrap(
      await snapshotEntry(f.deps, f.scope, { query: 'N1' }, { message: '  wording  ' }),
    );
    expect(second.outcome).toMatchObject({ kind: 'saved', revision: { summary: 'note: wording' } });
    const history = unwrap(await listRevisions(f.deps, f.scope, { query: 'N1' }));
    expect(history.revisions.map((r) => r.summary)).toEqual([
      'note: wording',
      'note: snapshot Entry',
    ]);
    expect(history.status.kind).toBe('clean');
    expect(unwrap(await listRevisions(f.deps, f.scope, { query: 'O1' })).revisions).toEqual([]);
  });

  it('answers not-under-version-control for an unversioned vault', async () => {
    const f = fixture();
    f.fs.files.set('n.md', v1);
    const saved = unwrap(await snapshotEntry(f.deps, f.scope, { query: 'N1' }));
    expect(saved.outcome).toEqual({ kind: 'not-under-version-control' });
    expect(f.revisions.recorded).toEqual([]);
  });

  it('surfaces a rejecting hook as an internal error with its output', async () => {
    const f = fixture();
    f.revisions.enable('/vault');
    f.fs.files.set('n.md', v1);
    f.revisions.rejectNext('lint: trailing whitespace');
    const rejected = await snapshotEntry(f.deps, f.scope, { query: 'N1' });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', details: { output: 'lint: trailing whitespace' } },
    });
    expect(unwrap(await listRevisions(f.deps, f.scope, { query: 'N1' })).revisions).toEqual([]);
    // The next save works again.
    expect(unwrap(await snapshotEntry(f.deps, f.scope, { query: 'N1' })).outcome.kind).toBe(
      'saved',
    );
  });

  it('refuses unknown notes like every other command', async () => {
    const f = fixture();
    expect(await snapshotEntry(f.deps, f.scope, { query: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
