import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listNotes } from './list-notes.js';
import { showNote } from './show-note.js';

const note = (id: string, title: string, aliases: string[] = [], body = '') =>
  `---\nid: ${id}\ntitle: ${title}\naliases: [${aliases.join(', ')}]\n---\n${body}`;

describe('listNotes / showNote', () => {
  it('lists identified and unidentified files, deriving titles when absent', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha', ['first'], 'See [[B1]] and [[A1|self]].'));
    f.fs.files.set('b.md', '# Beta heading\n');
    f.fs.files.set('c.md', 'plain text');
    f.fs.files.set('d.md', '---\nid: [not, scalar]\n---\n');

    const entries = unwrap(await listNotes(f.deps, f.vault));
    expect(entries.map((e) => [e.kind, e.title])).toEqual([
      ['note', 'Alpha'],
      ['unidentified', 'Beta heading'],
      ['unidentified', 'c'],
      ['unidentified', 'd'],
    ]);
    expect(entries[0]!.references.map((r) => r.target)).toEqual(['B1', 'A1']);
    expect(entries[3]!.issues).toEqual(['"id" must be a string']);
  });

  it('resolves by id, then case-insensitively by title or alias', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha', ['first']));
    f.fs.files.set('b.md', note('B1', 'Beta'));
    expect(unwrap(await showNote(f.deps, f.vault, 'A1')).path).toBe('a.md');
    expect(unwrap(await showNote(f.deps, f.vault, 'beta')).path).toBe('b.md');
    expect(unwrap(await showNote(f.deps, f.vault, 'FIRST')).path).toBe('a.md');
    expect(await showNote(f.deps, f.vault, 'nope')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('reports duplicate ids and ambiguous names instead of guessing', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('DUP', 'One', ['same']));
    f.fs.files.set('b.md', note('DUP', 'Two', ['same']));
    expect(await showNote(f.deps, f.vault, 'DUP')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS', details: { paths: ['a.md', 'b.md'] } },
    });
    expect(await showNote(f.deps, f.vault, 'same')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });
});
