import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listNotes } from '../notes/list-notes.js';
import type { WriteOptions } from '../ports.js';
import { setFields } from './set-fields.js';

const todo = '---\nid: T1 # keep\ntitle: Task\ntype: todo\nstatus: open\n---\n\n# Task\n\n[[A]]\n';

describe('setFields', () => {
  it('sets and adds keys through the codec, keeping comments and the body byte for byte', async () => {
    const f = fixture();
    f.fs.files.set('t.md', todo);
    const outcome = unwrap(
      await setFields(f.deps, f.scope, {
        note: 'Task',
        fields: { status: 'done', priority: 2, people: ['a', 'b'] },
      }),
    );
    expect(outcome).toMatchObject({ path: 't.md', written: true, dryRun: false });
    expect(f.fs.files.get('t.md')).toBe(
      '---\nid: T1 # keep\ntitle: Task\ntype: todo\nstatus: done\npriority: 2\npeople:\n  - a\n  - b\n---\n\n# Task\n\n[[A]]\n',
    );
    // The index saw the write.
    const [entry] = unwrap(await listNotes(f.deps, f.scope));
    expect(entry?.fields).toEqual({ status: 'done', priority: 2, people: ['a', 'b'] });
  });

  it('removes keys with null and treats an absent key as already removed', async () => {
    const f = fixture();
    f.fs.files.set('t.md', todo);
    unwrap(await setFields(f.deps, f.scope, { note: 'T1', fields: { status: null, due: null } }));
    expect(f.fs.files.get('t.md')).toBe(
      '---\nid: T1 # keep\ntitle: Task\ntype: todo\n---\n\n# Task\n\n[[A]]\n',
    );
  });

  it('is a no-op when every field already has the requested value', async () => {
    const f = fixture();
    f.fs.files.set('t.md', todo);
    const outcome = unwrap(
      await setFields(f.deps, f.scope, { note: 'T1', fields: { status: 'open', due: null } }),
    );
    expect(outcome).toEqual({ path: 't.md', written: false, dryRun: false });
    expect(f.fs.writes).toEqual([]);
  });

  it('previews as a diff in dry-run mode', async () => {
    const f = fixture();
    f.fs.files.set('t.md', todo);
    const outcome = unwrap(
      await setFields(f.deps, f.scope, { note: 'T1', fields: { status: 'done' }, dryRun: true }),
    );
    expect(outcome.written).toBe(false);
    expect(outcome.diff).toContain('-status: open\n+status: done\n');
    expect(f.fs.writes).toEqual([]);
  });

  it('refuses core keys and empty requests with VALIDATION', async () => {
    const f = fixture();
    f.fs.files.set('t.md', todo);
    expect(
      await setFields(f.deps, f.scope, { note: 'T1', fields: { title: 'X', status: 'done' } }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION', details: { keys: ['title'] } } });
    expect(await setFields(f.deps, f.scope, { note: 'T1', fields: {} })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(f.fs.writes).toEqual([]);
  });

  it('reports a concurrent edit as CONFLICT', async () => {
    const f = fixture();
    f.fs.files.set('t.md', todo);
    // Someone edits the file after it was read and before the write lands.
    const deps = {
      ...f.deps,
      notes: {
        ...f.deps.notes,
        write: (root: string, path: string, source: string, options?: WriteOptions) => {
          f.fs.files.set('t.md', todo.replace('open', 'later'));
          return f.deps.notes.write(root, path, source, options);
        },
      },
    };
    expect(
      await setFields(deps, f.scope, { note: 'T1', fields: { status: 'done' } }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(f.fs.files.get('t.md')).toContain('status: later');
  });
});
