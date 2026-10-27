import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Two real vaults, a named scope in a private XDG config, and the CLI through tsx. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

let base: string;
let home: string;
let one: string;
let two: string;

const notes = async (cwd: string, ...args: string[]): Promise<Outcome> => {
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'xdg') };
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callers name the shape
const json = <T>(outcome: Outcome): T => JSON.parse(outcome.stdout) as T;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'notes-scope-'));
  home = join(base, 'home');
  one = join(base, 'one');
  two = join(base, 'two');
  await mkdir(join(home, 'xdg', 'notes'), { recursive: true });
  await mkdir(one);
  await mkdir(two);
  await writeFile(
    join(home, 'xdg', 'notes', 'config.yaml'),
    `scopes:\n  both:\n    vaults: [${one}, ${two}]\n  broken:\n    vaults: [${one}, ${join(base, 'missing')}]\n`,
  );
  expect((await notes(one, 'init', '--name', 'one')).code).toBe(0);
  expect((await notes(two, 'init', '--name', 'two')).code).toBe(0);
  await writeFile(
    join(one, 'a.md'),
    '---\nid: A\ntitle: Alpha\naliases: [shared]\n---\nkumquat one\n',
  );
  await writeFile(join(one, 'dup.md'), '---\nid: DUP\ntitle: Dup one\n---\n');
  await writeFile(
    join(two, 'b.md'),
    '---\nid: B\ntitle: Beta\naliases: [shared]\n---\nkumquat two, see [[A]]\n',
  );
  await writeFile(join(two, 'dup.md'), '---\nid: DUP\ntitle: Dup two\n---\n');
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe('scopes (M4)', () => {
  it('federates search, backlinks and listing across a named scope', async () => {
    const search = json<{ hits: { vault: string; id: string; rankInVault: number }[] }>(
      await notes(base, '--scope', 'both', 'search', 'kumquat', '--json'),
    );
    expect(search.hits.map((h) => [h.vault, h.id, h.rankInVault])).toEqual([
      ['one', 'A', 1],
      ['two', 'B', 1],
    ]);
    const text = await notes(base, '--scope', 'both', 'list');
    expect(text.stdout).toMatch(/^one\s+A\s+Alpha\s+a\.md$/m);
    expect(text.stdout).toMatch(/^two\s+B\s+Beta\s+b\.md$/m);

    const back = json<{ backlinks: { vault: string; source: { id: string } }[] }>(
      await notes(base, '--scope', 'both', 'backlinks', 'Alpha', '--json'),
    );
    expect(back.backlinks.map((b) => [b.vault, b.source.id])).toEqual([['two', 'B']]);
    // The same query through explicit --vault paths builds the same scope.
    const viaPaths = await notes(base, '--vault', one, '--vault', two, 'backlinks', 'A', '--json');
    expect(json<{ backlinks: unknown[] }>(viaPaths).backlinks).toHaveLength(1);
  });

  it('refuses ambiguity: a duplicate id or shared alias across vaults exits 4, by id succeeds', async () => {
    expect((await notes(base, '--scope', 'both', 'show', 'DUP')).code).toBe(4);
    const shared = await notes(
      base,
      '--scope',
      'both',
      'reference',
      'add',
      '--source',
      'A',
      '--target',
      'shared',
      '--json',
    );
    expect(shared.code).toBe(4);
    expect(
      json<{ error: { details: { candidates: { vault: string }[] } } }>(
        shared,
      ).error.details.candidates.map((c) => c.vault),
    ).toEqual(['one', 'two']);
    const byId = await notes(
      base,
      '--scope',
      'both',
      'reference',
      'add',
      '--source',
      'A',
      '--target',
      'B',
    );
    expect(byId.code).toBe(0);
    expect((await notes(base, '--scope', 'both', 'reference', 'list', 'A')).stdout).toContain(
      '[[B]] -> Beta (two:b.md)',
    );
  });

  it('keeps working with a missing vault and says so where it matters', async () => {
    expect((await notes(base, '--scope', 'broken', 'show', 'A')).code).toBe(0);
    const miss = await notes(base, '--scope', 'broken', 'show', 'nothing', '--json');
    expect(miss.code).toBe(7);
    const show = await notes(base, '--scope', 'broken', 'scope', 'show');
    expect(show.stdout).toContain('unavailable');
    expect(show.stdout).toContain(join(base, 'missing'));
    const doctor = await notes(base, '--scope', 'broken', 'doctor', '--json');
    expect(doctor.code).toBe(6);
    expect(json<{ findings: { kind: string }[] }>(doctor).findings[0]?.kind).toBe(
      'unavailable-vault',
    );
    expect((await notes(base, 'scope', 'list')).stdout).toMatch(/^both\s/m);
  });

  it('writes need one vault: --in, or a cwd inside exactly one member', async () => {
    expect((await notes(base, '--scope', 'both', 'create', '--title', 'Nowhere')).code).toBe(2);
    const inside = await notes(one, '--scope', 'both', 'create', '--title', 'Inside', '--json');
    expect(inside.code).toBe(0);
    expect(json<{ vault: string }>(inside).vault).toBe('one');
    const named = await notes(
      base,
      '--scope',
      'both',
      'create',
      '--title',
      'Named',
      '--in',
      'two',
      '--json',
    );
    expect(json<{ vault: string; path: string }>(named)).toMatchObject({
      vault: 'two',
      path: 'named.md',
    });
    expect(
      (await notes(base, '--scope', 'both', 'create', '--title', 'X', '--in', 'nope')).code,
    ).toBe(2);
  });
});
