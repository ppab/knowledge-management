import { afterEach, describe, expect, it } from 'vitest';
import { harness, KEYS, type Terminal } from './harness.js';

/*
 * The note-creation flow (issue #4): the guarantees beyond the happy path that `list.test.tsx`
 * already covers — the editable title field, a single keyboard owner across the flow, and the
 * failure/empty paths that must stay recoverable.
 */

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('note creation', () => {
  it('keeps the dialog open with a message on an empty title, and recovers', async () => {
    const h = harness(() => undefined);
    term = h.start();
    await term.waitFor('0 notes');

    await term.press('c', KEYS.enter); // Enter with nothing typed
    const dialog = await term.waitFor('Title must not be empty');
    expect(dialog).toContain('new note'); // still in the flow, not back on the list
    expect(h.f.fs.writes).toEqual([]); // nothing was created

    // The same field recovers: type a title and go on to the selector.
    await term.press('R', 'e', 'a', 'l', KEYS.enter);
    await term.waitFor('new note "Real" · choose a template');
  });

  it('keeps spaces, an accent and an emoji typed into the title', async () => {
    const h = harness(() => undefined);
    term = h.start();
    await term.waitFor('0 notes');

    await term.press('c');
    await term.type('Niño 🎉'); // space, accent, emoji — all appended as text
    await term.press(KEYS.enter);
    const choice = await term.waitFor('choose a template');
    expect(choice).toContain('Niño 🎉'); // intact, not mangled
  });

  it('inserts at the cursor, not only at the end', async () => {
    const h = harness(() => undefined);
    term = h.start();
    await term.waitFor('0 notes');

    await term.press('c');
    await term.type('ello');
    await term.press(KEYS.left, KEYS.left, KEYS.left, KEYS.left); // move to the start
    await term.type('h'); // insert there, not at the end
    await term.press(KEYS.enter);
    const choice = await term.waitFor('choose a template');
    expect(choice).toContain('new note "hello"'); // "h" landed before "ello"
  });

  it('types shortcut keys as text in the title instead of acting on them', async () => {
    const h = harness((f) => {
      f.fs.files.set('a.md', '---\nid: A1\ntitle: Alpha\n---\n\nbody\n');
    });
    term = h.start();
    await term.waitFor('1 notes');

    await term.press('c');
    await term.type('j/t'); // j would move, / would search, t would tag — all are text here
    await term.press(KEYS.enter);
    const choice = await term.waitFor('new note "j/t" · choose a template');
    expect(choice).not.toContain('search:'); // '/' did not open the search prompt
    await term.press(KEYS.enter);
    await term.waitFor('j/t · monitor · ID1'); // created with that exact title
  });

  it('does not open the global menu while choosing a template', async () => {
    const h = harness(() => undefined);
    term = h.start();
    await term.waitFor('0 notes');

    await term.press('c', 'X', KEYS.enter);
    await term.waitFor('choose a template');
    await term.press(' '); // Space is the leader on the list, but the flow owns the keyboard
    // Nothing deterministic to wait on; give Ink a beat, then assert the menu never appeared.
    await term.press(' ');
    const frame = term.frame();
    expect(frame).not.toContain('Space …'); // the which-key popup did not open
    expect(frame).toContain('choose a template'); // still selecting
  });

  it('stays usable on a small terminal (40×15)', async () => {
    const h = harness(() => undefined);
    term = h.start(undefined, { columns: 40, rows: 15 });
    await term.waitFor('0 notes');

    await term.press('c', 'S', 'm', 'a', 'l', 'l', KEYS.enter);
    const choice = await term.waitFor('choose a template');
    expect(choice).toContain('default'); // the selector is visible
    expect(choice).toContain('Enter create'); // and so is the action hint
    await term.press(KEYS.enter);
    await term.waitFor('Small · monitor · ID1'); // the create still completes
  });

  it('shows a write failure, keeps the selection, and cancels cleanly', async () => {
    const h = harness((f) => {
      // The default template would write dup.md; a file already there forces a conflict.
      f.fs.files.set('dup.md', '---\nid: X1\ntitle: Existing\n---\n\nbody\n');
    });
    term = h.start();
    await term.waitFor('1 notes');

    await term.press('c', 'D', 'u', 'p', KEYS.enter);
    await term.waitFor('choose a template');
    await term.press(KEYS.enter); // confirm default → write conflicts on dup.md
    const failed = await term.waitFor('Refusing to overwrite');
    expect(failed).toContain('choose a template'); // selection kept, flow not blocked

    await term.press(KEYS.escape); // cancel is still available after the error
    await term.waitFor('1 notes');
    // Only the pre-existing file is present; the failed attempt wrote nothing new.
    expect(h.f.fs.writes.map((w) => w.path)).not.toContain('dup.md');
  });
});
