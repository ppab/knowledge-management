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
    await term.press('e');
    const after = await term.waitFor('new body');
    expect(after).toContain('Edited title · monitor · E');
    expect(editor.calls).toEqual([{ file: '/vault/e.md' }]);
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
    await term.press('e');
    await term.waitFor(() => editor.calls.length === 1);
    expect(editor.calls[0]).toEqual({ file: '/vault/e.md', command: 'my-editor --wait' });
    expect(rawDuringEditor).toBe(false);
    await term.waitFor(() => term!.stdin.rawMode[term!.stdin.rawMode.length - 1] === true);
    expect(term.stdin.rawMode).toEqual([true, false, true]);
  });
});
