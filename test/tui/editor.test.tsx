import { afterEach, describe, expect, it } from 'vitest';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { fakeEditor, harness, type Terminal } from './harness.js';

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('editor handoff', () => {
  it('opens the file in the editor, then re-renders the edited note', async () => {
    let files: Map<string, string> | undefined;
    const editor = fakeEditor((file) => {
      expect(file).toBe('/vault/e.md');
      files?.set('e.md', '---\nid: E\ntitle: Edited title\n---\n\nnew body\n');
    });
    const h = harness(
      (f) => {
        files = f.fs.files;
        f.fs.files.set('e.md', '---\nid: E\ntitle: Editable\n---\n\nold body\n');
      },
      { editor },
    );
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'E' })]);
    await term.waitFor('old body');
    await term.press('o');
    const after = await term.waitFor('new body');
    expect(after).toContain('Edited title · monitor · E');
    expect(editor.calls).toEqual([{ file: '/vault/e.md' }]);
  });

  it('holds off its own mutations while the external editor owns the terminal', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let files: Map<string, string> | undefined;
    const editor = fakeEditor(async (file) => {
      expect(file).toBe('/vault/e.md');
      // The user edits externally, then the session stays open until the test releases it.
      files?.set('e.md', '---\nid: E\ntitle: Edited title\n---\n\nedited body\n');
      await gate;
    });
    const h = harness(
      (f) => {
        files = f.fs.files;
        f.fs.files.set('e.md', '---\nid: E\ntitle: Editable\n---\n\nold body\n');
      },
      { editor },
    );
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'E' })]);
    await term.waitFor('old body');

    const writesBefore = h.f.fs.writes.length;
    await term.press('o');
    await term.waitFor(() => editor.calls.length === 1); // the editor now holds the terminal

    // Keys pressed now reach the suspended terminal, not the TUI: nothing starts a flow or write.
    await term.press('s'); // would open the save dialog if input were live
    await term.press('I'); // would open the reference picker
    await term.press('o'); // would try to launch a second editor
    expect(editor.calls).toHaveLength(1); // no second handoff
    expect(h.f.fs.writes.length).toBe(writesBefore); // no application write slipped in
    const during = term.frame();
    expect(during).not.toContain('save message:'); // no dialog opened under the editor
    expect(during).not.toContain('find:');

    release();
    const after = await term.waitFor('edited body'); // the edit lands once the session ends
    expect(after).toContain('Edited title · monitor · E');
    expect(after).not.toContain('save message:'); // no buffered key reopened a flow after resume
  });

  it('passes the vault editor setting and restores raw mode around the editor', async () => {
    let rawDuringEditor: boolean | undefined;
    const editor = fakeEditor(() => {
      const raw = term?.stdin.rawMode ?? [];
      rawDuringEditor = raw[raw.length - 1];
    });
    const h = harness(
      (f) => {
        f.vaults.set('/vault', { ...f.vault.config, editor: 'my-editor --wait' });
        f.fs.files.set('e.md', '---\nid: E\ntitle: Editable\n---\n\nbody\n');
      },
      { editor },
    );
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'E' })], {
      interactive: true,
    });
    await term.waitFor('body');
    expect(term.stdin.rawMode[term.stdin.rawMode.length - 1]).toBe(true);
    await term.press('o');
    await term.waitFor(() => editor.calls.length === 1);
    expect(editor.calls[0]).toEqual({ file: '/vault/e.md', command: 'my-editor --wait' });
    expect(rawDuringEditor).toBe(false);
    await term.waitFor(() => term!.stdin.rawMode[term!.stdin.rawMode.length - 1] === true);
    expect(term.stdin.rawMode).toEqual([true, false, true]);
  });
});
