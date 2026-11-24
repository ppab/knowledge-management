import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** `ofl release` through the real CLI: a vault nested in a real repository with a bare remote. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

interface Released {
  status: string;
  tag: string;
  commit: string;
  remote?: string;
  uncommitted: boolean;
}

let base: string;
let repo: string;
let remote: string;
let vault: string;
let env: NodeJS.ProcessEnv;

const ofl = async (cwd: string, ...args: string[]): Promise<Outcome> => {
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};
const git = async (cwd: string, ...args: string[]) =>
  (await run('git', args, { cwd, env })).stdout.trim();

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'notes-release-'));
  repo = join(base, 'repo');
  remote = join(base, 'remote.git');
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
  await run('git', ['init', '-q', '--bare', remote], { env });
  expect((await ofl(vault, 'init', '--name', 'demo')).code).toBe(0);
  await appendFile(
    join(vault, '.ofl', 'config.yaml'),
    'publications:\n  ppab:\n    destination: markdown\n    output: ./out\n',
  );
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'vault');
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe('ofl release', () => {
  it('refuses a name that is not a configured publication', async () => {
    const unknown = await ofl(vault, 'release', 'nope', '--json');
    expect(unknown.code).toBe(3);
    expect(JSON.parse(unknown.stdout)).toMatchObject({
      error: { code: 'NOT_FOUND', details: { names: ['ppab'] } },
    });
    expect(await git(repo, 'tag', '--list')).toBe('');
  });

  it('refuses to push without a remote, and tags locally with --no-push', async () => {
    const refused = await ofl(vault, 'release', 'ppab');
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--no-push');
    expect(await git(repo, 'tag', '--list')).toBe('');

    const dry = await ofl(vault, 'release', 'ppab', '--no-push', '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toMatch(/^Would tag release\/ppab\/\d{8}T\d{6}Z at [0-9a-f]{7}\n$/);
    expect(await git(repo, 'tag', '--list')).toBe('');

    const tagged = await ofl(vault, 'release', 'ppab', '--no-push', '--json');
    expect(tagged.code).toBe(0);
    const outcome = JSON.parse(tagged.stdout) as Released;
    expect(outcome).toMatchObject({ status: 'tagged', uncommitted: false });
    expect(outcome.tag).toMatch(/^release\/ppab\/\d{8}T\d{6}Z$/);
    expect(outcome.commit).toBe(await git(repo, 'rev-parse', 'HEAD'));
    // Annotated, and on the checked-out commit.
    expect(await git(repo, 'cat-file', '-t', outcome.tag)).toBe('tag');
    expect(await git(repo, 'rev-parse', `${outcome.tag}^{commit}`)).toBe(outcome.commit);
    await git(repo, 'tag', '-d', outcome.tag);
  });

  it('pushes the tag, and only the tag, to the remote', async () => {
    await git(repo, 'remote', 'add', 'origin', remote);
    await appendFile(join(vault, 'loose.md'), 'not committed\n');

    const released = await ofl(vault, 'release', 'ppab', '--json');
    expect(released.code).toBe(0);
    const outcome = JSON.parse(released.stdout) as Released;
    expect(outcome).toMatchObject({ status: 'released', remote: 'origin', uncommitted: true });
    expect(await git(remote, 'rev-parse', `${outcome.tag}^{commit}`)).toBe(outcome.commit);
    expect(await git(remote, 'for-each-ref', '--format=%(refname)')).toBe(
      `refs/tags/${outcome.tag}`,
    );
  });

  it('a failed push exits 1, keeps the tag and says how to send it', async () => {
    await git(repo, 'remote', 'add', 'gone', join(base, 'missing.git'));
    // A release is stamped to the second; let the previous one's second pass.
    await new Promise((done) => setTimeout(done, 1100));
    const failed = await ofl(vault, 'release', 'ppab', '--remote', 'gone');
    expect(failed.code).toBe(1);
    expect(failed.stderr).toMatch(/git push gone release\/ppab\/\d{8}T\d{6}Z/);
    expect((await git(repo, 'tag', '--list')).split('\n')).toHaveLength(2);
  });
});
