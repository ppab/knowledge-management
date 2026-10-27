import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { insertAt, replaceRange } from '../../domain/text/text-edit.js';
import { fixture } from '../../../test/fakes/index.js';
import { showNote } from '../notes/show-note.js';
import { mutateNote } from './mutate.js';

const SOURCE = '---\nid: A\ntitle: Alpha\n---\n\n# Alpha\n\nBody [[B]].\n';

const setup = async () => {
  const f = fixture();
  f.fs.files.set('a.md', SOURCE);
  const { note } = unwrap(await showNote(f.deps, f.scope, 'A'));
  const index = unwrap(await f.deps.indexes.open(f.vault.root));
  return { f, note, index };
};

describe('mutateNote', () => {
  it('writes with the version it read and refreshes the index for that path', async () => {
    const { f, note, index } = await setup();
    const out = unwrap(
      await mutateNote(f.deps, f.vault, index, note, [insertAt(SOURCE.length, '\nMore [[C]].\n')], {
        referenceDelta: 1,
        frontmatter: 'unchanged',
      }),
    );
    expect(out).toMatchObject({ written: true, dryRun: false });
    expect(f.fs.files.get('a.md')).toBe(SOURCE + '\nMore [[C]].\n');
    expect(index.outgoing('a.md').map((r) => r.target)).toEqual(['B', 'C']);
  });

  it('dry-run returns a diff and writes nothing; an identity edit is a no-op', async () => {
    const { f, note, index } = await setup();
    const out = unwrap(
      await mutateNote(
        f.deps,
        f.vault,
        index,
        note,
        [insertAt(SOURCE.length, '\nMore.\n')],
        { referenceDelta: 0, frontmatter: 'unchanged' },
        { dryRun: true },
      ),
    );
    expect(out.written).toBe(false);
    expect(out.diff).toContain('+More.');
    expect(f.fs.writes).toEqual([]);
    const same = unwrap(
      await mutateNote(f.deps, f.vault, index, note, [replaceRange({ start: 0, end: 3 }, '---')], {
        referenceDelta: 0,
        frontmatter: 'unchanged',
      }),
    );
    expect(same).toEqual({ path: 'a.md', written: false, dryRun: false });
  });

  it('refuses writes whose effect is not the intended one', async () => {
    const { f, note, index } = await setup();
    const attempt = (
      edits: Parameters<typeof mutateNote>[4],
      expect: Parameters<typeof mutateNote>[5],
    ) => mutateNote(f.deps, f.vault, index, note, edits, expect);
    const refusal = { ok: false, error: { code: 'INTERNAL' } };

    // Wrong reference delta.
    expect(
      await attempt([insertAt(SOURCE.length, '[[X]]\n')], {
        referenceDelta: 0,
        frontmatter: 'unchanged',
      }),
    ).toMatchObject(refusal);
    // A heading sneaks in (setext underline turns the last paragraph into a heading).
    expect(
      await attempt([insertAt(SOURCE.length, '---\n')], {
        referenceDelta: 0,
        frontmatter: 'unchanged',
      }),
    ).toMatchObject(refusal);
    // Frontmatter touched when it must not be.
    expect(
      await attempt([replaceRange({ start: 4, end: 9 }, 'id: Z')], {
        referenceDelta: 0,
        frontmatter: 'unchanged',
      }),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('identity') as string },
    });
    expect(
      await attempt([insertAt(9, '\ntags: [x]')], { referenceDelta: 0, frontmatter: 'unchanged' }),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('frontmatter') as string },
    });
    // Body touched when only frontmatter may change.
    expect(
      await attempt([insertAt(SOURCE.length, 'x\n')], {
        referenceDelta: 0,
        frontmatter: 'changed',
      }),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining('body') as string } });
    expect(f.fs.writes).toEqual([]);
  });

  it('exits with a conflict when the file changed after it was read', async () => {
    const { f, note, index } = await setup();
    f.fs.files.set('a.md', SOURCE + 'someone else\n');
    const result = await mutateNote(
      f.deps,
      f.vault,
      index,
      note,
      [insertAt(SOURCE.length, 'me\n')],
      { referenceDelta: 0, frontmatter: 'unchanged' },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(f.fs.files.get('a.md')).toBe(SOURCE + 'someone else\n');
  });
});
