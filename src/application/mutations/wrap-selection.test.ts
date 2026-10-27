import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { wrapSelectionAsExternalLink, wrapSelectionAsReference } from './wrap-selection.js';

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
});
