import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { deleteEntry, previewDelete } from './delete-entry.js';
import { listEntries } from './list-entries.js';

const note = (id: string, title: string, body = '') =>
  `---\nid: ${id}\ntitle: ${title}\n---\n${body}`;

describe('deleteEntry', () => {
  it('removes the file and drops it from the index when the vault is unversioned', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha'));

    const out = unwrap(await deleteEntry(f.deps, f.scope, { query: 'A1' }));
    expect(out.record.kind).toBe('unversioned');
    expect(out.referrers).toEqual([]);
    expect(f.fs.files.has('a.md')).toBe(false);
    expect(unwrap(await listEntries(f.deps, f.scope))).toEqual([]);
    expect(f.revisions.recorded).toEqual([]);
  });

  it('records the deletion as a note-scoped revision when the note was tracked', async () => {
    const f = fixture();
    const src = note('A1', 'Alpha');
    f.fs.files.set('a.md', src);
    f.revisions.enable('/vault');
    f.revisions.seed('/vault', 'a.md', src);

    const out = unwrap(await deleteEntry(f.deps, f.scope, { query: 'A1' }));
    expect(out.record.kind).toBe('recorded');
    expect(f.fs.files.has('a.md')).toBe(false);
    expect(f.revisions.recorded).toEqual([
      { root: '/vault', path: 'a.md', message: 'note: delete Alpha' },
    ]);
  });

  it('uses a given message and does not double-scope one that already carries it', async () => {
    const f = fixture();
    const src = note('A1', 'Alpha');
    f.fs.files.set('a.md', src);
    f.revisions.enable('/vault');
    f.revisions.seed('/vault', 'a.md', src);

    unwrap(await deleteEntry(f.deps, f.scope, { query: 'A1' }, { message: 'note: superseded' }));
    expect(f.revisions.recorded.at(-1)?.message).toBe('note: superseded');
  });

  it('removes but does not record a note that was never committed', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha'));
    f.revisions.enable('/vault');

    const out = unwrap(await deleteEntry(f.deps, f.scope, { query: 'A1' }));
    expect(out.record.kind).toBe('unrecorded');
    expect(f.fs.files.has('a.md')).toBe(false);
    expect(f.revisions.recorded).toEqual([]);
  });

  it('refuses when other notes link in, unless forced, and previews the referrers', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha'));
    f.fs.files.set('b.md', note('B1', 'Beta', 'See [[A1]].'));

    const preview = unwrap(await previewDelete(f.deps, f.scope, { query: 'A1' }));
    expect(preview.referrers).toEqual([
      { vault: 'monitor', path: 'b.md', title: 'Beta', id: 'B1' },
    ]);
    expect(f.fs.files.has('a.md')).toBe(true); // a preview deletes nothing

    const blocked = await deleteEntry(f.deps, f.scope, { query: 'A1' });
    expect(blocked).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(f.fs.files.has('a.md')).toBe(true);

    const forced = unwrap(await deleteEntry(f.deps, f.scope, { query: 'A1' }, { force: true }));
    expect(forced.referrers.map((r) => r.id)).toEqual(['B1']);
    expect(f.fs.files.has('a.md')).toBe(false);
  });

  it('ignores a note referencing itself when deciding whether links would dangle', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha', 'Links to [[A1|myself]].'));

    const out = unwrap(await deleteEntry(f.deps, f.scope, { query: 'A1' }));
    expect(out.referrers).toEqual([]);
    expect(f.fs.files.has('a.md')).toBe(false);
  });
});
