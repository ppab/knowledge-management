import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listNotes } from './list-notes.js';
import { showNote } from './show-note.js';

const note = (id: string, title: string, aliases: string[] = [], body = '', extra = '') =>
  `---\nid: ${id}\ntitle: ${title}\naliases: [${aliases.join(', ')}]\n${extra}---\n${body}`;

describe('listNotes / showNote', () => {
  it('lists identified and unidentified files, deriving titles when absent', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha', ['first'], 'See [[B1]] and [[A1|self]].'));
    f.fs.files.set('b.md', '# Beta heading\n');
    f.fs.files.set('c.md', 'plain text');
    f.fs.files.set('d.md', '---\nid: [not, scalar]\n---\n');

    const entries = unwrap(await listNotes(f.deps, f.scope));
    expect(entries.map((e) => [e.kind, e.title])).toEqual([
      ['note', 'Alpha'],
      ['unidentified', 'Beta heading'],
      ['unidentified', 'c'],
      ['unidentified', 'd'],
    ]);
    expect(entries[3]!.issues).toEqual(['"id" must be a string']);

    const shown = unwrap(await showNote(f.deps, f.scope, 'A1'));
    expect(shown.vault.config.name).toBe('monitor');
    expect(shown.note.references.map((r) => r.target)).toEqual(['B1', 'A1']);
    expect(shown.note.source).toBe(f.fs.files.get('a.md'));
  });

  it('filters by tag and by date or date range', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'A', [], '', 'tags: [x]\ndates: [2026-10-01]\n'));
    f.fs.files.set('b.md', note('B1', 'B', [], '', 'tags: [x, y]\ndates: [2026-10-15]\n'));
    f.fs.files.set('c.md', note('C1', 'C', [], '', 'dates: [2026-11-01]\n'));
    const paths = async (filters: Parameters<typeof listNotes>[2]) =>
      unwrap(await listNotes(f.deps, f.scope, filters)).map((e) => e.path);
    expect(await paths({ tag: 'y' })).toEqual(['b.md']);
    expect(await paths({ tag: 'x' })).toEqual(['a.md', 'b.md']);
    expect(await paths({ date: '2026-10-15' })).toEqual(['b.md']);
    expect(await paths({ date: '2026-10-01..2026-10-31' })).toEqual(['a.md', 'b.md']);
    expect(await paths({ tag: 'x', date: '2026-10-02..2026-12-31' })).toEqual(['b.md']);
    expect(await listNotes(f.deps, f.scope, { date: 'yesterday' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('resolves by id, then case-insensitively by title or alias', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Alpha', ['first']));
    f.fs.files.set('b.md', note('B1', 'Beta'));
    expect(unwrap(await showNote(f.deps, f.scope, 'A1')).note.path).toBe('a.md');
    expect(unwrap(await showNote(f.deps, f.scope, 'beta')).note.path).toBe('b.md');
    expect(unwrap(await showNote(f.deps, f.scope, 'FIRST')).note.path).toBe('a.md');
    expect(await showNote(f.deps, f.scope, 'nope')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('reports duplicate ids and ambiguous names instead of guessing', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('DUP', 'One', ['same']));
    f.fs.files.set('b.md', note('DUP', 'Two', ['same']));
    expect(await showNote(f.deps, f.scope, 'DUP')).toMatchObject({
      ok: false,
      error: {
        code: 'AMBIGUOUS',
        details: {
          candidates: [
            expect.objectContaining({ path: 'a.md' }),
            expect.objectContaining({ path: 'b.md' }),
          ],
        },
      },
    });
    expect(await showNote(f.deps, f.scope, 'same')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });

  it('sees edits made after the index was built', async () => {
    const f = fixture();
    f.fs.files.set('a.md', note('A1', 'Before'));
    expect(unwrap(await showNote(f.deps, f.scope, 'A1')).note.title).toBe('Before');
    f.fs.files.set('a.md', note('A1', 'After'));
    expect(unwrap(await showNote(f.deps, f.scope, 'After')).note.path).toBe('a.md');
    f.fs.files.delete('a.md');
    expect(await showNote(f.deps, f.scope, 'A1')).toMatchObject({ ok: false });
  });
});
