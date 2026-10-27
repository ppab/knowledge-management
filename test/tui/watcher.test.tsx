import { afterEach, describe, expect, it } from 'vitest';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { harness, type Terminal } from './harness.js';

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('watcher-driven refresh', () => {
  it('updates the list and the open note when files change on disk', async () => {
    const h = harness((f) => {
      f.fs.files.set('a.md', '---\nid: A\ntitle: Alpha\n---\n\nfirst version\n');
    });
    term = h.start();
    await term.waitFor('1 notes');

    h.f.fs.files.set('b.md', '---\nid: B\ntitle: Brand new\n---\n\nhello\n');
    h.changes.fire();
    await term.waitFor('2 notes');
    expect(term.frame()).toContain('Brand new');
    term.unmount();

    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'A' })]);
    await term.waitFor('first version');
    h.f.fs.files.set('a.md', '---\nid: A\ntitle: Alpha\n---\n\nsecond version\n');
    h.changes.fire();
    await term.waitFor('second version');
  });
});
