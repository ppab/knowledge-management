import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../../src/interfaces/cli/version.js';

/*
 * Smoke test of the compiled executable (`bun run compile`): the same commands the Node
 * integration tests cover, run through the binary with Node removed from PATH. Skipped when no
 * binary for this machine has been built, so `bun run test` stays green on a fresh checkout.
 */
const run = promisify(execFile);
const binary = resolve(
  import.meta.dirname,
  `../../release/notes-${process.platform}-${process.arch}`,
);

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
    const { stdout, stderr } = await run(binary, args, { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};
const succeeded = (outcome: Outcome): Outcome => {
  expect(outcome.code, outcome.stderr).toBe(0);
  return outcome;
};
const json = (outcome: Outcome): unknown => JSON.parse(succeeded(outcome).stdout);

describe.skipIf(!existsSync(binary))('compiled notes binary', () => {
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'notes-binary-'));
    repo = join(base, 'repo');
    vault = join(repo, 'vault');
    await mkdir(vault, { recursive: true });
    env = {
      // No Node on PATH: only git and the binary itself.
      PATH: '/usr/bin:/bin',
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

  it('reports its version', async () => {
    const version = await notes(base, '--version');
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(VERSION);
  });

  it('init, create, list and search work, so the bundled SQLite index runs under Bun', async () => {
    const init = json(await notes(vault, 'init', '--name', 'demo', '--json')) as { name: string };
    expect(init.name).toBe('demo');

    const created = json(await notes(vault, 'create', '--title', 'Kumquat Harvest', '--json')) as {
      id: string;
      path: string;
    };
    expect(created.path).toBe('kumquat-harvest.md');
    const file = join(vault, created.path);
    await writeFile(file, (await readFile(file, 'utf8')) + 'The kumquats ripened early.\n');

    const listed = json(await notes(vault, 'list', '--json')) as { notes: { id: string }[] };
    expect(listed.notes.map((n) => n.id)).toEqual([created.id]);

    const search = json(await notes(vault, 'search', 'kumquats', '--json')) as {
      hits: { id: string }[];
    };
    expect(search.hits.map((h) => h.id)).toEqual([created.id]);
  });

  it('saves a note to git', async () => {
    const saved = await notes(vault, 'save', 'kumquat harvest', '-m', 'first words');
    expect(saved.code, saved.stderr).toBe(0);
    const log = await run('git', ['log', '--format=%s'], { cwd: repo, env });
    expect(log.stdout.trim()).toBe('note: first words');
  });

  it('refuses to open the TUI without a terminal, which shows Ink is bundled and loads', async () => {
    const bare = await notes(vault);
    expect(bare.code).toBe(2);
    expect(bare.stdout + bare.stderr).toMatch(/terminal/i);
  });
});
