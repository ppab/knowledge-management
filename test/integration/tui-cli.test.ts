import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** M5 through the real CLI: `notes` without a terminal, and `notes edit` with a fake editor. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

let root: string;

const notes = async (args: string[], env: Record<string, string> = {}) => {
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'notes-tui-cli-'));
  expect((await notes(['init', '--name', 'demo'])).code).toBe(0);
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('notes (no subcommand) and notes edit', () => {
  it('refuses to start the TUI without a terminal, with a usage error', async () => {
    const result = await notes([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('interactive terminal');
    const asJson = await notes(['--json']);
    expect(JSON.parse(asJson.stdout)).toMatchObject({ error: { code: 'USAGE' } });
  });

  it('opens the note file in $EDITOR and the next read sees the edit', async () => {
    const created = await notes(['create', '--title', 'Draft', '--json']);
    const { id, path } = JSON.parse(created.stdout) as { id: string; path: string };
    const fake = join(root, 'fake-editor.sh');
    await writeFile(fake, '#!/bin/sh\nprintf "\\nappended by editor\\n" >> "$1"\n', {
      mode: 0o755,
    });

    const edited = await notes(['edit', 'Draft'], { EDITOR: fake, VISUAL: '' });
    expect(edited.code).toBe(0);
    expect(edited.stdout).toBe(`Edited ${path}\n`);
    expect(await readFile(join(root, path), 'utf8')).toContain('appended by editor');
    expect((await notes(['show', id])).stdout).toContain('appended by editor');

    const missing = await notes(['edit', 'Nope'], { EDITOR: fake });
    expect(missing.code).toBe(3);
    const noEditor = await notes(['edit', 'Draft'], { EDITOR: 'no-such-editor-xyz', VISUAL: '' });
    expect(noEditor.code).toBe(7);
  });
});
