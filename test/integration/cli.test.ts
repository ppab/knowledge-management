import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Runs the real CLI (through tsx) in a temporary vault. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

const notes = async (cwd: string, ...args: string[]): Promise<Outcome> => {
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'notes-cli-'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('notes CLI (M1)', () => {
  it('init → create → list → show, with --json and exit codes', async () => {
    const init = await notes(root, 'init', '--name', 'demo', '--json');
    expect(init.code).toBe(0);
    const config = JSON.parse(init.stdout) as { name: string; id: string };
    expect(config.name).toBe('demo');

    expect((await notes(root, 'init')).code).toBe(6); // already a vault

    const created = await notes(root, 'create', '--title', 'Hello World', '--json');
    expect(created.code).toBe(0);
    const note = JSON.parse(created.stdout) as { id: string; path: string };
    expect(note.path).toBe('hello-world.md');

    const again = await notes(root, 'create', '--title', 'Hello World');
    expect(again.code).toBe(5);

    const list = await notes(root, 'list', '--json');
    const listed = JSON.parse(list.stdout) as { notes: { id: string }[] };
    expect(listed.notes.map((n) => n.id)).toEqual([note.id]);

    const show = await notes(join(root), 'show', 'hello world');
    expect(show.code).toBe(0);
    expect(show.stdout).toContain(`id: ${note.id}`);

    const missing = await notes(root, 'show', 'nope', '--json');
    expect(missing.code).toBe(3);
    expect(JSON.parse(missing.stdout)).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('adopts an unidentified file without touching anything but the id', async () => {
    const original = '---\n# keep me\ntitle: Legacy # note\nextra: [1, 2]\n---\n\nBody [[X]]\n';
    await writeFile(join(root, 'legacy.md'), original);

    const list = await notes(root, 'list', '--unidentified', '--json');
    const listed = JSON.parse(list.stdout) as { notes: { path: string; kind: string }[] };
    expect(listed.notes).toEqual([
      expect.objectContaining({ path: 'legacy.md', kind: 'unidentified' }),
    ]);

    const adopt = await notes(root, 'adopt', 'legacy.md', '--json');
    expect(adopt.code).toBe(0);
    const { adopted } = JSON.parse(adopt.stdout) as { adopted: { id: string }[] };
    const after = await readFile(join(root, 'legacy.md'), 'utf8');
    expect(after).toBe(
      original.replace('extra: [1, 2]\n', `extra: [1, 2]\nid: ${adopted[0]!.id}\n`),
    );

    const raw = await notes(root, 'show', 'Legacy', '--raw');
    expect(raw.stdout).toBe(after + '\n');
  });

  it('runs from a nested directory and fails clearly outside a vault', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'notes-outside-'));
    try {
      const res = await notes(outside, 'list');
      expect(res.code).toBe(3);
      expect(res.stderr).toContain('No vault found');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    expect((await notes(root, '--cwd', root, 'list')).code).toBe(0);
    expect((await notes(root, 'bogus')).code).toBe(2);
  });
});
