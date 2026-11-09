import { afterEach, describe, expect, it } from 'vitest';
import { entryScreen } from '../../src/interfaces/tui/model.js';
import { harness, KEYS, type Terminal } from './harness.js';

const note = (id: string, title: string, body = '') =>
  `---\nid: ${id}\ntitle: ${title}\n---\n\n${body}\n`;

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('deleting notes', () => {
  it('confirms from the list, warns about inbound links, cancels, then deletes', async () => {
    const h = harness((f) => {
      f.fs.files.set('a.md', note('A1', 'Alpha'));
      f.fs.files.set('b.md', note('B1', 'Beta', 'See [[A1]].'));
    });
    term = h.start();
    await term.waitFor('2 notes');

    // Alpha is linked from Beta: the confirmation warns before deleting.
    await term.press('D');
    const confirm = await term.waitFor('Delete "Alpha"?');
    expect(confirm).toContain('link here');
    expect(confirm).toContain('Beta');

    // `n` cancels: nothing is removed.
    await term.press('n');
    await term.waitFor('2 notes');
    expect(h.f.fs.files.has('a.md')).toBe(true);

    // Beta has nothing pointing at it: a plain confirmation, then `y` deletes it.
    await term.press('j', 'D');
    await term.waitFor('Delete "Beta"?');
    await term.press('y');
    const after = await term.waitFor('1 notes');
    expect(after).toContain('Deleted Beta');
    expect(h.f.fs.files.has('b.md')).toBe(false);
  });

  it('records the deletion in a versioned vault', async () => {
    const h = harness((f) => {
      const src = note('A1', 'Alpha');
      f.fs.files.set('a.md', src);
      f.revisions.enable('/vault');
      f.revisions.seed('/vault', 'a.md', src);
    });
    term = h.start();
    await term.waitFor('1 notes');

    await term.press('D');
    await term.waitFor('Delete "Alpha"?');
    await term.press('y');
    await term.waitFor('0 notes');
    expect(h.f.revisions.recorded).toEqual([
      { root: '/vault', path: 'a.md', message: 'note: delete Alpha' },
    ]);
  });

  it('deletes from the open note and returns to the list', async () => {
    const h = harness((f) => {
      f.fs.files.set('a.md', note('A1', 'Alpha', 'the body'));
    });
    term = h.start([{ kind: 'list', cursor: 0 }, entryScreen({ query: 'A1' })], { columns: 100 });
    await term.waitFor('Alpha · monitor · A1');
    expect(term.frame()).toContain('s snapshot  t tag  D delete');

    await term.press('D');
    await term.waitFor('Delete "Alpha"?');
    await term.press(KEYS.enter); // Enter confirms
    await term.waitFor('0 notes');
    expect(h.f.fs.files.has('a.md')).toBe(false);
  });
});
