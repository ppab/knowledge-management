import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import {
  checkSelection,
  wrapSelectionAsExternalLink,
  wrapSelectionAsReference,
} from './wrap-selection.js';

const A = '---\nid: A\n---\n\n# Alpha\n\nRead the design doc and `code` now.\n';
const range = (needle: string) => {
  const start = A.indexOf(needle);
  return { start, end: start + needle.length };
};

describe('wrapSelection use cases', () => {
  it('turns a selection into a labelled reference to the resolved target', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    f.fs.files.set('d.md', '---\nid: D\ntitle: Design doc\n---\n');
    unwrap(
      await wrapSelectionAsReference(f.deps, f.scope, {
        note: 'A',
        selection: range('design doc'),
        target: 'design doc',
      }),
    );
    expect(f.fs.files.get('a.md')).toBe(A.replace('design doc', '[[D|design doc]]'));
  });

  it('turns a selection into an external link and refuses invalid selections', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    unwrap(
      await wrapSelectionAsExternalLink(f.deps, f.scope, {
        note: 'A',
        selection: range('design'),
        url: 'https://x.test',
      }),
    );
    expect(f.fs.files.get('a.md')).toBe(A.replace('design', '[design](https://x.test)'));
    f.fs.files.set('a.md', A);
    for (const needle of ['`code`', 'Alpha', 'and `code']) {
      expect(
        await wrapSelectionAsExternalLink(f.deps, f.scope, {
          note: 'A',
          selection: range(needle),
          url: 'u',
        }),
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    expect(f.fs.files.get('a.md')).toBe(A);
  });

  it('refuses with a conflict when the note is not the version the selection was made on', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    f.fs.files.set('d.md', '---\nid: D\ntitle: Design doc\n---\n');
    const stale = { note: 'A', selection: range('design'), expectedVersion: 'not-this-one' };
    for (const result of [
      await checkSelection(f.deps, f.scope, stale),
      await wrapSelectionAsReference(f.deps, f.scope, { ...stale, target: 'D' }),
      await wrapSelectionAsExternalLink(f.deps, f.scope, { ...stale, url: 'u' }),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', message: 'a.md changed on disk since it was read' },
      });
    }
    expect(f.fs.files.get('a.md')).toBe(A);
    expect(f.fs.writes).toHaveLength(0);
  });

  it('checkSelection applies the wrap rules without writing', async () => {
    const f = fixture();
    f.fs.files.set('a.md', A);
    expect(
      await checkSelection(f.deps, f.scope, { note: 'A', selection: range('design') }),
    ).toEqual({ ok: true, value: undefined });
    expect(
      await checkSelection(f.deps, f.scope, { note: 'A', selection: range('and `code') }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: expect.stringContaining('crosses formatting') as string,
      },
    });
    expect(f.fs.writes).toHaveLength(0);
  });
});
