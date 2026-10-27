import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { backlinks, listReferences } from './references.js';

const note = (id: string, title: string, body: string) =>
  `---\nid: ${id}\ntitle: ${title}\n---\n${body}`;

describe('references', () => {
  it('lists outgoing references with their resolution', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A', 'Alpha', 'See [[B]], [[B|labelled]], [[X]] and [[D]].\n'));
    f.fs.files.set('b.md', note('B', 'Beta', ''));
    f.fs.files.set('d1.md', note('D', 'Dup one', ''));
    f.fs.files.set('d2.md', note('D', 'Dup two', ''));

    const listing = unwrap(await listReferences(f.deps, f.scope, 'alpha'));
    expect(listing.source.id).toBe('A');
    expect(listing.references.map((r) => [r.target, r.label ?? null, r.resolution.state])).toEqual([
      ['B', null, 'resolved'],
      ['B', 'labelled', 'resolved'],
      ['X', null, 'unresolved'],
      ['D', null, 'ambiguous'],
    ]);
    expect(listing.references[0]!.range).toEqual({ start: 31, end: 36 });
  });

  it('finds backlinks from identified and unidentified files, by id or alias', async () => {
    const f = fixture();
    f.fs.files.set('b.md', '---\nid: B\ntitle: Beta\naliases: [bee]\n---\n');
    f.fs.files.set('a.md', note('A', 'Alpha', 'To [[B]] and again [[B|there]].\n'));
    f.fs.files.set('u.md', 'No id here, but [[B]].\n');
    f.fs.files.set('n.md', note('N', 'Nope', '`[[B]]` in code does not count.\n'));

    const listing = unwrap(await backlinks(f.deps, f.scope, 'bee'));
    expect(listing.target.id).toBe('B');
    expect(listing.backlinks.map((b) => [b.source.path, b.label ?? null])).toEqual([
      ['a.md', null],
      ['a.md', 'there'],
      ['u.md', null],
    ]);
    expect(unwrap(await backlinks(f.deps, f.scope, 'A')).backlinks).toEqual([]);
    expect(await backlinks(f.deps, f.scope, 'zzz')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
