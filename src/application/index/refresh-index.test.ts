import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import type { NoteIndex } from '../ports.js';
import { indexStatus, rebuildIndex, refreshIndex } from './refresh-index.js';

const note = (id: string, title: string, body = '') =>
  `---\nid: ${id}\ntitle: ${title}\n---\n${body}`;

const open = async (f: ReturnType<typeof fixture>): Promise<NoteIndex> =>
  unwrap(await f.deps.indexes.open(f.vault.root));

describe('index refresh', () => {
  it('adds, updates and removes incrementally, touching only what changed', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'A'));
    f.fs.files.set('b.md', note('B1', 'B'));
    const index = await open(f);

    expect(unwrap(await refreshIndex(f.deps, f.vault, index))).toEqual({
      added: ['a.md', 'b.md'],
      modified: [],
      removed: [],
      unchanged: 0,
    });
    expect(unwrap(await refreshIndex(f.deps, f.vault, index))).toEqual({
      added: [],
      modified: [],
      removed: [],
      unchanged: 2,
    });

    f.fs.files.set('b.md', note('B1', 'B two'));
    f.fs.files.set('c.md', note('C1', 'C'));
    f.fs.files.delete('a.md');
    const status = unwrap(await indexStatus(f.deps, f.vault, index));
    expect(status.stale).toEqual({ added: ['c.md'], modified: ['b.md'], removed: ['a.md'] });
    expect(status.stats.notes).toBe(2); // status does not write

    const before = index.files().find((x) => x.path === 'b.md')!;
    expect(unwrap(await refreshIndex(f.deps, f.vault, index))).toEqual({
      added: ['c.md'],
      modified: ['b.md'],
      removed: ['a.md'],
      unchanged: 0,
    });
    expect(index.all().map((e) => [e.path, e.title])).toEqual([
      ['b.md', 'B two'],
      ['c.md', 'C'],
    ]);
    expect(index.files().find((x) => x.path === 'b.md')!.version).not.toBe(before.version);
  });

  it('refreshes only the given paths when asked', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'A'));
    f.fs.files.set('b.md', note('B1', 'B'));
    const index = await open(f);
    unwrap(await refreshIndex(f.deps, f.vault, index));

    f.fs.files.set('a.md', note('A1', 'A changed'));
    f.fs.files.set('b.md', note('B1', 'B changed'));
    f.fs.files.set('c.md', note('C1', 'C'));
    expect(
      unwrap(await refreshIndex(f.deps, f.vault, index, { paths: ['a.md', 'gone.md'] })),
    ).toEqual({ added: [], modified: ['a.md'], removed: [], unchanged: 0 });
    expect(index.all().map((e) => e.title)).toEqual(['A changed', 'B']);
    f.fs.files.delete('b.md');
    unwrap(await refreshIndex(f.deps, f.vault, index, { paths: ['b.md'] }));
    expect(index.all().map((e) => e.path)).toEqual(['a.md']);
  });

  it('indexes a physical note reached by two paths once, keeping the canonical path', async () => {
    const f = fixture();
    f.fs.files.set('real.md', note('A1', 'A'));
    f.fs.links = new Map([['zzz-alias.md', 'real.md']]);
    const index = await open(f);
    unwrap(await refreshIndex(f.deps, f.vault, index));
    expect(index.all().map((e) => e.path)).toEqual(['real.md']); // alias collapsed
    expect(index.byId('A1')).toHaveLength(1); // not a false ambiguity
  });

  it('keeps two separate files that share an id as distinct, ambiguous rows', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('DUP', 'A'));
    f.fs.files.set('b.md', note('DUP', 'B'));
    const index = await open(f);
    unwrap(await refreshIndex(f.deps, f.vault, index));
    expect(index.byId('DUP')).toHaveLength(2); // integrity error preserved
  });

  it('a targeted refresh of a non-canonical alias cannot resurrect a duplicate', async () => {
    const f = fixture();
    f.fs.files.set('real.md', note('A1', 'A'));
    f.fs.links = new Map([['zzz-alias.md', 'real.md']]);
    const index = await open(f);
    unwrap(await refreshIndex(f.deps, f.vault, index));
    expect(index.byId('A1')).toHaveLength(1);

    f.fs.files.set('real.md', note('A1', 'A changed'));
    unwrap(await refreshIndex(f.deps, f.vault, index, { paths: ['zzz-alias.md'] }));
    expect(index.byId('A1')).toHaveLength(1);
    expect(index.all().map((e) => [e.path, e.title])).toEqual([['real.md', 'A changed']]);
  });

  it('re-selects the canonical path deterministically as aliases appear and disappear', async () => {
    const f = fixture();
    f.fs.files.set('real.md', note('A1', 'A'));
    f.fs.links = new Map([['bbb.md', 'real.md']]);
    const index = await open(f);
    unwrap(await refreshIndex(f.deps, f.vault, index));
    expect(index.all().map((e) => e.path)).toEqual(['bbb.md']); // 'bbb.md' < 'real.md'

    f.fs.links.set('aaa.md', 'real.md'); // a smaller alias appears → new canonical
    unwrap(await refreshIndex(f.deps, f.vault, index));
    expect(index.all().map((e) => e.path)).toEqual(['aaa.md']);
    expect(index.byId('A1')).toHaveLength(1);

    f.fs.links.delete('aaa.md'); // the selected path is removed → survivor promoted
    unwrap(await refreshIndex(f.deps, f.vault, index));
    expect(index.all().map((e) => e.path)).toEqual(['bbb.md']);
    expect(index.byId('A1')).toHaveLength(1);
  });

  it('rebuild from scratch equals the incremental result', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'A', 'see [[B1]]'));
    const index = await open(f);
    unwrap(await refreshIndex(f.deps, f.vault, index));
    f.fs.files.set('b.md', note('B1', 'B', 'back to [[A1]]'));
    f.fs.files.set('a.md', note('A1', 'A!', 'see [[B1]] twice [[B1|again]]'));
    unwrap(await refreshIndex(f.deps, f.vault, index));
    const incremental = { all: index.all(), refs: index.backlinks('B1'), stats: index.stats() };

    unwrap(await rebuildIndex(f.deps, f.vault, index));
    expect({ all: index.all(), refs: index.backlinks('B1'), stats: index.stats() }).toEqual(
      incremental,
    );
    expect(incremental.refs).toHaveLength(2);
  });
});
