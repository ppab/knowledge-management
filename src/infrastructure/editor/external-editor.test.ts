import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExternalEditor, resolveEditorCommand } from './external-editor.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-editor-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('resolveEditorCommand', () => {
  it('prefers the vault setting, then VISUAL, then EDITOR, then nvim', () => {
    expect(resolveEditorCommand('code --wait', { VISUAL: 'v', EDITOR: 'e' })).toBe('code --wait');
    expect(resolveEditorCommand(undefined, { VISUAL: 'v', EDITOR: 'e' })).toBe('v');
    expect(resolveEditorCommand(undefined, { VISUAL: ' ', EDITOR: 'e' })).toBe('e');
    expect(resolveEditorCommand(undefined, {})).toBe('nvim');
  });
});

describe('external editor', () => {
  it('runs the command with the file appended and resolves on exit 0', async () => {
    const editor = createExternalEditor({});
    const target = join(dir, 'note.md');
    // "cp" stands in for an editor: it receives the file as its last argument.
    const result = await editor.open(target, { command: `cp ${join(dir, 'missing-ok')}` });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    // A fake editor that writes to the file it was given; the command carries an argument.
    const fake = join(dir, 'fake-editor.sh');
    await writeFile(fake, '#!/bin/sh\nprintf "$1" > "$2"\n', { mode: 0o755 });
    const touched = await editor.open(target, { command: `${fake} edited` });
    expect(touched.ok).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('edited');
  });

  it('reports a missing editor as UNAVAILABLE', async () => {
    const result = await createExternalEditor({ EDITOR: 'definitely-not-an-editor-xyz' }).open(
      join(dir, 'x.md'),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });
});
