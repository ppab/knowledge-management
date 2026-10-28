import { afterEach, describe, expect, it } from 'vitest';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { harness, KEYS, type Terminal } from './harness.js';

const v1 = '---\nid: N1\ntitle: Note\n---\n\nfirst words\n';
const v2 = '---\nid: N1\ntitle: Note\n---\n\nsecond words\n';
const v3 = '---\nid: N1\ntitle: Note\n---\n\nthird words\n';

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('history and save in the TUI', () => {
  it('marks an unsaved note with ● and records a revision from the s prompt', async () => {
    const h = harness((f) => {
      f.revisions.enable('/vault');
      f.fs.files.set('n.md', v1);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'N1' })]);
    await term.waitFor('Note · monitor · N1 ●');
    expect(term.frame()).toContain('s save  H history');

    await term.press('s');
    await term.waitFor('save message:');
    await term.type('wording');
    await term.press(KEYS.enter);
    await term.waitFor('Saved revision rev0001: note: wording');
    expect(h.f.revisions.recorded).toEqual([
      { root: '/vault', path: 'n.md', message: 'note: wording' },
    ]);
    await term.waitFor((f) => f.includes('Note · monitor · N1\n'));

    // Saving a clean note records nothing; Esc cancels the prompt.
    await term.press('s', KEYS.enter);
    await term.waitFor('Nothing to save: n.md matches revision rev0001');
    await term.press('s');
    await term.waitFor('save message:');
    await term.press(KEYS.escape);
    await term.waitFor((f) => !f.includes('save message:'));
    expect(h.f.revisions.recorded).toHaveLength(1);

    // An edit on disk brings the marker back, and the changed line gets a gutter mark that a
    // save clears; an empty message takes the default.
    expect(term.frame()).not.toContain('▎');
    h.f.fs.files.set('n.md', v2);
    h.changes.fire();
    await term.waitFor('Note · monitor · N1 ●');
    await term.waitFor('▎ second words');
    await term.press('s', KEYS.enter);
    await term.waitFor('Saved revision rev0002: note: save Note');
    await term.waitFor((f) => f.includes('Note · monitor · N1\n'));
    await term.waitFor((f) => !f.includes('▎'));
  });

  it('explains an unversioned vault and a rejecting hook', async () => {
    const h = harness((f) => {
      f.fs.files.set('n.md', v1);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'N1' })]);
    await term.waitFor((f) => f.includes('Note · monitor · N1\n'));
    await term.press('s', KEYS.enter);
    await term.waitFor('Nothing saved: n.md is not under version control');
    await term.press('H');
    await term.waitFor('n.md is not under version control');
    await term.press(KEYS.escape);
    await term.waitFor((f) => f.includes('Note · monitor · N1\n'));

    h.f.revisions.enable('/vault');
    h.f.revisions.rejectNext('hook says no');
    h.changes.fire();
    await term.waitFor('Note · monitor · N1 ●');
    await term.press('s', KEYS.enter);
    await term.waitFor('internal: Revision of n.md was not recorded');
    expect(term.frame()).toContain('Note · monitor · N1 ●');
  });

  it('lists revisions on H, opens one on Enter, and diffs it against the working file on d', async () => {
    const h = harness((f) => {
      f.revisions.enable('/vault');
      f.fs.files.set('n.md', v3);
      f.revisions.seed('/vault', 'n.md', v1, 'first');
      f.revisions.seed('/vault', 'n.md', v2, 'second');
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'N1' })]);
    await term.waitFor('Note · monitor · N1 ●');
    await term.press('H');
    const list = await term.waitFor('history · Note · monitor · N1');
    expect(list).toContain('rev      date              author  summary');
    const rows = list.split('\n').filter((line) => line.includes('Seed'));
    expect(rows.map((r) => r.replace('▸', '').trim())).toEqual([
      'rev0002  2026-10-27 12:02  Seed    second',
      'rev0001  2026-10-27 12:01  Seed    first',
    ]);

    // Enter on the older revision shows the note as it was then.
    await term.press('j', KEYS.enter);
    const old = await term.waitFor('@ rev0001 (2026-10-27 12:01) first');
    expect(old).toContain('first words');
    expect(old).not.toContain('third words');
    await term.press(KEYS.escape);
    await term.waitFor('history · Note');

    // d diffs the selected revision against the working file.
    await term.press('d');
    const diff = await term.waitFor('diff · Note · rev0001 → working file');
    expect(diff).toContain('-first words');
    expect(diff).toContain('+third words');
    await term.press(KEYS.escape, KEYS.escape);
    await term.waitFor('Note · monitor · N1 ●');
    expect(term.frame()).toContain('third words');
  });

  it('previews the selected revision beside the list on a wide terminal', async () => {
    const h = harness((f) => {
      f.revisions.enable('/vault');
      f.fs.files.set('n.md', v3);
      f.revisions.seed('/vault', 'n.md', v1, 'first');
      f.revisions.seed('/vault', 'n.md', v2, 'second');
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'N1' })], { columns: 120 });
    await term.waitFor('Note · monitor · N1 ●');
    await term.press('H');
    const list = await term.waitFor('rev0002 · 2026-10-27 12:02 · second');
    expect(list).toContain('second words'); // the newest revision's content, beside the list
    expect(list).toContain('d diff vs working  Ctrl-d/u scroll preview  Enter full screen');

    await term.press('j');
    await term.waitFor('rev0001 · 2026-10-27 12:01 · first');
    expect(term.frame()).toContain('first words');
    expect(term.frame()).not.toContain('second words');

    // d flips the pane to the diff against the working file and back; the list stays.
    await term.press('d');
    const diff = await term.waitFor('rev0001 · 2026-10-27 12:01 · first → working file');
    expect(diff).toContain('-first words');
    expect(diff).toContain('+third words');
    expect(diff).toContain('d content');
    await term.press('d');
    await term.waitFor((f) => f.includes('first words') && !f.includes('+third words'));

    // Enter still opens the revision full screen; Esc comes back to the same selection.
    await term.press(KEYS.enter);
    await term.waitFor('@ rev0001 (2026-10-27 12:01) first');
    await term.press(KEYS.escape);
    await term.waitFor('rev0001 · 2026-10-27 12:01 · first');
  });

  it('says so when nothing was recorded yet', async () => {
    const h = harness((f) => {
      f.revisions.enable('/vault');
      f.fs.files.set('n.md', v1);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'N1' })]);
    await term.waitFor('Note · monitor · N1 ●');
    await term.press('H');
    await term.waitFor('No revisions recorded for n.md; press s in the note to save one');
    await term.press(KEYS.enter);
    await term.waitFor('No revision selected');
  });
});
