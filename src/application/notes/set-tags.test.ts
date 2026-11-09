import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listNotes } from './list-notes.js';
import { parseTagLine, setTags } from './set-tags.js';

describe('parseTagLine', () => {
  it('splits on commas and whitespace, strips a leading #, and drops blanks', () => {
    expect(parseTagLine('  #work, reading   #idea ')).toEqual(['work', 'reading', 'idea']);
    expect(parseTagLine('')).toEqual([]);
  });
});

describe('setTags', () => {
  it('adds tags, keeps the rest of the file intact, and removes the key when emptied', async () => {
    const f = fixture();
    const source = '---\nid: A\ntitle: Alpha\nextra: [1, 2]\n---\n\nBody.\n';
    f.fs.files.set('a.md', source);

    unwrap(await setTags(f.deps, f.scope, { note: 'A', tags: ['work', 'reading'] }));
    expect(f.fs.files.get('a.md')).toContain('tags:\n  - work\n  - reading\n');
    expect(unwrap(await listNotes(f.deps, f.scope, { tag: 'reading' })).map((e) => e.path)).toEqual(
      ['a.md'],
    );

    // Writing the same set (deduplicated, order kept) is a no-op.
    expect(
      unwrap(await setTags(f.deps, f.scope, { note: 'A', tags: ['work', 'reading', 'work'] }))
        .written,
    ).toBe(false);
    expect(f.fs.writes).toHaveLength(1);

    // Editing the set replaces it; an empty set removes the key and restores the file.
    unwrap(await setTags(f.deps, f.scope, { note: 'A', tags: ['reading'] }));
    expect(f.fs.files.get('a.md')).toContain('tags:\n  - reading\n');
    expect(f.fs.files.get('a.md')).not.toContain('work');
    unwrap(await setTags(f.deps, f.scope, { note: 'A', tags: [] }));
    expect(f.fs.files.get('a.md')).toBe(source);
  });

  it('previews with dry-run and writes nothing', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n');
    const preview = unwrap(
      await setTags(f.deps, f.scope, { note: 'A', tags: ['x'], dryRun: true }),
    );
    expect(preview.diff).toContain('+tags:\n+  - x\n');
    expect(f.fs.writes).toEqual([]);
  });
});
