import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { searchNotes } from './search-notes.js';

describe('searchNotes', () => {
  it('matches title, alias and body, ranks titles first and numbers results', async () => {
    const f = fixture();
    f.fs.files.set('t.md', '---\nid: T\ntitle: Kubernetes basics\n---\nNothing else.\n');
    f.fs.files.set('a.md', '---\nid: A\ntitle: Cluster notes\naliases: [kubernetes]\n---\nMeh.\n');
    f.fs.files.set('b.md', '---\nid: B\ntitle: Diary\n---\nToday I learned kubernetes.\n');
    f.fs.files.set('u.md', 'Unidentified but about kubernetes too.\n');
    f.fs.files.set('n.md', '---\nid: N\ntitle: Unrelated\n---\nCats.\n');

    const hits = unwrap(await searchNotes(f.deps, f.scope, 'kubernetes'));
    expect(hits.map((h) => h.entry.path)).toEqual(['t.md', 'a.md', 'b.md', 'u.md']);
    expect(hits.map((h) => h.rankInVault)).toEqual([1, 2, 3, 4]);
    expect(hits[0]).toMatchObject({ vault: 'monitor', snippet: '[Kubernetes] basics' });
    expect(hits[2]!.snippet).toContain('[kubernetes]');

    expect(unwrap(await searchNotes(f.deps, f.scope, 'kuber*')).map((h) => h.entry.path)).toEqual([
      't.md',
      'a.md',
      'b.md',
      'u.md',
    ]);
    expect(unwrap(await searchNotes(f.deps, f.scope, 'kubernetes', { limit: 2 }))).toHaveLength(2);
    expect(unwrap(await searchNotes(f.deps, f.scope, 'kubernetes cats'))).toEqual([]);
    expect(await searchNotes(f.deps, f.scope, '  ')).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
  });
});
