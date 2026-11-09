import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { classifyEntry } from './classify-entry.js';
import { showEntry } from './show-entry.js';

const typeOf = async (f: ReturnType<typeof fixture>, query: string): Promise<string | undefined> =>
  unwrap(await showEntry(f.deps, f.scope, query)).note.type;

describe('classifyEntry', () => {
  it('files a raw capture under a type, retypes it, and clears it back to the inbox', async () => {
    const f = fixture();
    const source = '---\nid: A\ntitle: Alpha\n---\n\nBody [[B]].\n';
    f.fs.files.set('a.md', source);
    expect(await typeOf(f, 'A')).toBeUndefined(); // raw, unclassified

    unwrap(await classifyEntry(f.deps, f.scope, { query: 'A', type: 'todo' }));
    expect(await typeOf(f, 'A')).toBe('todo');
    expect(f.fs.files.get('a.md')).toContain('type: todo');
    expect(f.fs.files.get('a.md')).toContain('Body [[B]].'); // body untouched

    unwrap(await classifyEntry(f.deps, f.scope, { query: 'A', type: 'time' })); // retype
    expect(await typeOf(f, 'A')).toBe('time');

    unwrap(await classifyEntry(f.deps, f.scope, { query: 'A', clear: true }));
    expect(await typeOf(f, 'A')).toBeUndefined();
    expect(f.fs.files.get('a.md')).not.toContain('type:');
  });

  it('is a no-op when the type is unchanged or already clear', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\ntype: todo\n---\n');
    expect(unwrap(await classifyEntry(f.deps, f.scope, { query: 'A', type: 'todo' })).written).toBe(
      false,
    );
    f.fs.files.set('b.md', '---\nid: B\n---\n');
    expect(unwrap(await classifyEntry(f.deps, f.scope, { query: 'B', clear: true })).written).toBe(
      false,
    );
    expect(f.fs.writes).toEqual([]);
  });

  it('requires a type unless clearing, and previews with dry-run', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n');
    expect(await classifyEntry(f.deps, f.scope, { query: 'A', type: '  ' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    const preview = unwrap(
      await classifyEntry(f.deps, f.scope, { query: 'A', type: 'note', dryRun: true }),
    );
    expect(preview.diff).toContain('+type: note');
    expect(f.fs.writes).toEqual([]);
  });
});
