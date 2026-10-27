import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import type { Revision } from '../../domain/revision/revision.js';
import { createGitRevisionProvider } from './revision-provider.js';

const exec = promisify(execFile);

let base: string;
let repo: string;
/** The vault sits two directories below the repository root. */
let vault: string;
let env: Record<string, string>;

const git = async (...args: string[]): Promise<string> =>
  (await exec('git', args, { cwd: repo, env: { ...process.env, ...env } })).stdout;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'notes-git-'));
  repo = join(base, 'repo');
  vault = join(repo, 'sub', 'vault');
  await mkdir(join(vault, 'docs'), { recursive: true });
  env = {
    HOME: base,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Tester',
    GIT_AUTHOR_EMAIL: 'tester@example.com',
    GIT_COMMITTER_NAME: 'Tester',
    GIT_COMMITTER_EMAIL: 'tester@example.com',
  };
  await exec('git', ['init', '-q', '-b', 'main', repo], { env: { ...process.env, ...env } });
});
afterAll(() => rm(base, { recursive: true, force: true }));

const note = (body: string) => `---\nid: N1\ntitle: Note\n---\n\n${body}\n`;

describe('git revision provider', () => {
  it('treats a directory outside any repository as unversioned', async () => {
    const plain = join(base, 'plain');
    await mkdir(plain);
    await writeFile(join(plain, 'n.md'), note('x'));
    const provider = createGitRevisionProvider({ env });
    expect(unwrap(await provider.status(plain, 'n.md'))).toEqual({ kind: 'unversioned' });
    expect(unwrap(await provider.list(plain, 'n.md'))).toEqual([]);
    const revision: Revision = { id: 'x', timestamp: '', summary: '', path: 'n.md' };
    expect(await provider.read(plain, revision)).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
    expect(await provider.record(plain, 'n.md', 'm')).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
  });

  it('records a nested vault file in an empty repository and reads it back', async () => {
    const provider = createGitRevisionProvider({ env });
    await writeFile(join(vault, 'n.md'), note('first'));
    expect(unwrap(await provider.status(vault, 'n.md'))).toEqual({ kind: 'unrecorded' });
    expect(unwrap(await provider.list(vault, 'n.md'))).toEqual([]);

    const first = unwrap(await provider.record(vault, 'n.md', 'first words'));
    expect(first).toMatchObject({
      summary: 'first words',
      author: 'Tester',
      path: 'sub/vault/n.md',
    });
    expect(first.id).toMatch(/^[0-9a-f]{40}$/);
    expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(unwrap(await provider.status(vault, 'n.md'))).toEqual({ kind: 'clean', last: first });
    expect(unwrap(await provider.read(vault, first))).toBe(note('first'));

    await writeFile(join(vault, 'n.md'), note('second'));
    expect(unwrap(await provider.status(vault, 'n.md'))).toEqual({
      kind: 'modified',
      last: first,
    });
  });

  it('commits only the note, leaving unrelated staged changes staged', async () => {
    const provider = createGitRevisionProvider({ env });
    await writeFile(join(repo, 'unrelated.txt'), 'staged elsewhere\n');
    await git('add', 'unrelated.txt');
    await writeFile(join(vault, 'docs', 'other.md'), '# other\n');
    await git('add', 'sub/vault/docs/other.md');

    const second = unwrap(await provider.record(vault, 'n.md', 'second words'));
    expect((await git('show', '--name-only', '--format=', 'HEAD')).trim()).toBe('sub/vault/n.md');
    expect((await git('diff', '--cached', '--name-only')).trim().split('\n').sort()).toEqual([
      'sub/vault/docs/other.md',
      'unrelated.txt',
    ]);
    expect(unwrap(await provider.list(vault, 'n.md')).map((r) => r.summary)).toEqual([
      'second words',
      'first words',
    ]);
    expect(second.summary).toBe('second words');
    await git('reset', '-q');
  });

  it('follows the file across a rename and reads the old path at old revisions', async () => {
    const provider = createGitRevisionProvider({ env });
    await git('mv', 'sub/vault/n.md', 'sub/vault/docs/moved.md');
    await git('commit', '-q', '-m', 'move it', '--', 'sub/vault/n.md', 'sub/vault/docs/moved.md');
    await writeFile(join(vault, 'docs', 'moved.md'), note('third'));
    unwrap(await provider.record(vault, 'docs/moved.md', 'third words'));

    const history = unwrap(await provider.list(vault, 'docs/moved.md'));
    expect(history.map((r) => [r.summary, r.path])).toEqual([
      ['third words', 'sub/vault/docs/moved.md'],
      ['move it', 'sub/vault/docs/moved.md'],
      ['second words', 'sub/vault/n.md'],
      ['first words', 'sub/vault/n.md'],
    ]);
    expect(unwrap(await provider.read(vault, history[3]!))).toBe(note('first'));
    expect(unwrap(await provider.read(vault, history[0]!))).toBe(note('third'));
    expect(unwrap(await provider.status(vault, 'docs/moved.md'))).toEqual({
      kind: 'clean',
      last: history[0],
    });
    expect(unwrap(await provider.status(vault, 'n.md'))).toEqual({ kind: 'unrecorded' });
  });

  it('surfaces a rejecting pre-commit hook and records nothing', async () => {
    const provider = createGitRevisionProvider({ env });
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    try {
      await writeFile(join(vault, 'docs', 'moved.md'), note('fourth'));
      const rejected = await provider.record(vault, 'docs/moved.md', 'fourth words');
      expect(rejected).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
      if (!rejected.ok) {
        expect(rejected.error.message).toContain('hook says no');
        expect(rejected.error.details).toMatchObject({ code: 1, output: 'hook says no' });
      }
      expect(unwrap(await provider.list(vault, 'docs/moved.md'))).toHaveLength(4);
      expect(unwrap(await provider.status(vault, 'docs/moved.md')).kind).toBe('modified');
      expect(await readFile(join(vault, 'docs', 'moved.md'), 'utf8')).toBe(note('fourth'));
    } finally {
      await rm(hook);
    }
  });

  it('takes paths with glob characters literally', async () => {
    const provider = createGitRevisionProvider({ env });
    await writeFile(join(vault, 'docs', 'plan [draft].md'), '# plan\n');
    const recorded = unwrap(await provider.record(vault, 'docs/plan [draft].md', 'draft'));
    expect(recorded.path).toBe('sub/vault/docs/plan [draft].md');
    expect(unwrap(await provider.status(vault, 'docs/plan [draft].md')).kind).toBe('clean');
    expect(unwrap(await provider.read(vault, recorded))).toBe('# plan\n');
  });

  it('reports a missing historical path as not found', async () => {
    const provider = createGitRevisionProvider({ env });
    const [latest] = unwrap(await provider.list(vault, 'docs/moved.md'));
    expect(await provider.read(vault, { ...latest!, path: 'sub/vault/never.md' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
