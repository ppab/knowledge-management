import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** M7 through the real CLI in a vault nested inside a real Git repository. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

let base: string;
let repo: string;
let vault: string;
let env: NodeJS.ProcessEnv;

const notes = async (cwd: string, ...args: string[]): Promise<Outcome> => {
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};
const git = async (...args: string[]) => (await run('git', args, { cwd: repo, env })).stdout;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'notes-history-'));
  repo = join(base, 'repo');
  vault = join(repo, 'vault');
  await mkdir(vault, { recursive: true });
  env = {
    ...process.env,
    HOME: base,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Tester',
    GIT_AUTHOR_EMAIL: 'tester@example.com',
    GIT_COMMITTER_NAME: 'Tester',
    GIT_COMMITTER_EMAIL: 'tester@example.com',
  };
  await run('git', ['init', '-q', '-b', 'main', repo], { env });
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe('notes history / diff / save / show --at (M7)', () => {
  let id: string;
  let path: string;
  let firstRevision: string;

  it('save records one note and only that note; unchanged notes have nothing to save', async () => {
    expect((await notes(vault, 'init', '--name', 'demo')).code).toBe(0);
    const created = await notes(vault, 'create', '--title', 'Hello', '--json');
    ({ id, path } = JSON.parse(created.stdout) as { id: string; path: string });

    const before = await notes(vault, 'history', id);
    expect(before.code).toBe(0);
    expect(before.stdout.trim()).toBe(`No revisions recorded for ${path}`);

    await writeFile(join(repo, 'unrelated.txt'), 'staged\n');
    await git('add', 'unrelated.txt');
    const saved = await notes(vault, 'save', id, '-m', 'first words', '--json');
    expect(saved.code).toBe(0);
    const outcome = JSON.parse(saved.stdout) as {
      status: string;
      revision: { id: string; summary: string; path: string };
    };
    expect(outcome.status).toBe('saved');
    expect(outcome.revision).toMatchObject({ summary: 'first words', path: `vault/${path}` });
    firstRevision = outcome.revision.id;
    expect((await git('show', '--name-only', '--format=', 'HEAD')).trim()).toBe(`vault/${path}`);
    expect((await git('diff', '--cached', '--name-only')).trim()).toBe('unrelated.txt');

    const again = await notes(vault, 'save', id);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('Nothing to save');
    const againJson = await notes(vault, 'save', id, '--json');
    expect(JSON.parse(againJson.stdout)).toMatchObject({ status: 'nothing-to-save' });
  });

  it('diff defaults to last revision → working file; show --at reads history untouched', async () => {
    const file = join(vault, path);
    const original = await readFile(file, 'utf8');
    await writeFile(file, `${original}\nAdded later.\n`);

    const diff = await notes(vault, 'diff', id);
    expect(diff.code).toBe(0);
    expect(diff.stdout).toContain(`--- a/${path}`);
    expect(diff.stdout).toContain('+Added later.');

    const at = await notes(vault, 'show', id, '--at', firstRevision.slice(0, 7));
    expect(at.code).toBe(0);
    expect(at.stdout).toContain(`revision: ${firstRevision.slice(0, 7)} (`);
    expect(at.stdout).not.toContain('Added later.');
    const raw = await notes(vault, 'show', id, '--at', firstRevision, '--raw');
    expect(raw.stdout).toBe(`${original}\n`); // `out` ends every print with a newline
    const current = await notes(vault, 'show', id, '--raw');
    expect(current.stdout).toContain('Added later.');

    const history = await notes(vault, 'history', id);
    expect(history.stdout).toContain('first words');
    expect(history.stdout).toContain(
      `(${path} has changed since its last revision (${firstRevision.slice(0, 7)}))`,
    );
    const missing = await notes(vault, 'show', id, '--at', 'ffffffff', '--json');
    expect(missing.code).toBe(3);
  });

  it('a rejecting pre-commit hook exits 1 with its output and commits nothing', async () => {
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    try {
      const rejected = await notes(vault, 'save', id, '-m', 'second words');
      expect(rejected.code).toBe(1);
      expect(rejected.stderr).toContain('hook says no');
      expect((await git('log', '--format=%s')).trim()).toBe('first words');
    } finally {
      await rm(hook);
    }
    const saved = await notes(vault, 'save', id, '-m', 'second words');
    expect(saved.code).toBe(0);
    expect(saved.stdout).toContain('second words');
    const between = await notes(vault, 'diff', id, '--from', firstRevision.slice(0, 7), '--json');
    expect(JSON.parse(between.stdout)).toMatchObject({ to: 'working' });
    expect((JSON.parse(between.stdout) as { patch: string }).patch).toContain('+Added later.');
  });

  it('history follows a rename', async () => {
    await git('mv', `vault/${path}`, 'vault/renamed.md');
    await git('commit', '-q', '-m', 'move', '--', `vault/${path}`, 'vault/renamed.md');
    const history = await notes(vault, 'history', id, '--json');
    expect(history.code).toBe(0);
    const parsed = JSON.parse(history.stdout) as {
      path: string;
      status: { kind: string };
      revisions: { summary: string; path: string }[];
    };
    expect(parsed.path).toBe('renamed.md');
    expect(parsed.status.kind).toBe('clean');
    expect(parsed.revisions.map((r) => [r.summary, r.path])).toEqual([
      ['move', 'vault/renamed.md'],
      ['second words', `vault/${path}`],
      ['first words', `vault/${path}`],
    ]);
  });

  it('handles a vault outside any repository gracefully', async () => {
    const plain = join(base, 'plain');
    await mkdir(plain);
    expect((await notes(plain, 'init', '--name', 'plain')).code).toBe(0);
    const created = await notes(plain, 'create', '--title', 'Loose', '--json');
    const loose = JSON.parse(created.stdout) as { id: string };

    const saved = await notes(plain, 'save', loose.id, '--json');
    expect(saved.code).toBe(0);
    expect(JSON.parse(saved.stdout)).toMatchObject({ status: 'not-under-version-control' });
    const text = await notes(plain, 'save', loose.id);
    expect(text.stdout).toContain('is not under version control');
    const history = await notes(plain, 'history', loose.id);
    expect(history.code).toBe(0);
    expect(history.stdout).toContain('is not under version control');
    const diff = await notes(plain, 'diff', loose.id, '--json');
    expect(diff.code).toBe(3);
    expect(JSON.parse(diff.stdout)).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
