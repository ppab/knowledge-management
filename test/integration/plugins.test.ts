import { execFile } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The M4.5 acceptance flow: the todos plugin through the real CLI in a temporary vault. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

let root: string;

const notes = async (...args: string[]): Promise<Outcome> => {
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], { cwd: root });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callers name the shape
const json = <T>(outcome: Outcome): T => JSON.parse(outcome.stdout) as T;

const today = (): string => {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'notes-plugins-'));
  expect((await notes('init', '--name', 'demo')).code).toBe(0);
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('todos plugin (M4.5)', () => {
  it('is an unknown command and an unknown template until the vault enables it', async () => {
    const disabled = await notes('todos', 'list');
    expect(disabled.code).toBe(2);
    expect(disabled.stderr).toContain('not enabled');
    expect((await notes('create', '--template', 'todos/task', '--title', 'X')).code).toBe(3);
    const caps = json<{ plugins: { name: string; enabled: boolean }[] }>(
      await notes('capabilities', '--json'),
    );
    expect(caps.plugins).toEqual([expect.objectContaining({ name: 'todos', enabled: false })]);
  });

  it('creates, lists, closes and checks todos once enabled', async () => {
    await appendFile(join(root, '.notes', 'config.yaml'), 'plugins:\n  todos:\n');

    const created = await notes('create', '--template', 'todos/task', '--title', 'Ship', '--json');
    expect(created.code).toBe(0);
    const { id, path, frontmatter } = json<{
      id: string;
      path: string;
      frontmatter: Record<string, unknown>;
    }>(created);
    expect(frontmatter).toMatchObject({ type: 'todo', status: 'open' });
    const file = join(root, path);
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('status: open', `status: open\ndue: ${today()}`),
    );

    const due = json<{ todos: { id: string; due: string }[] }>(
      await notes('todos', 'list', '--due', 'today', '--json'),
    );
    expect(due.todos).toEqual([expect.objectContaining({ id, due: today() })]);
    expect((await notes('todos', 'list')).stdout).toContain('Ship');

    // show prints the declared fields with their types.
    const shown = await notes('show', id);
    expect(shown.stdout).toContain('fields:\n  status: open (enum)\n  due:');
    const { declaredFields } = json<{
      declaredFields: { declared: { name: string; type: string; value?: unknown }[] };
    }>(await notes('show', id, '--json'));
    expect(declaredFields.declared.map((f) => [f.name, f.type, f.value])).toEqual([
      ['status', 'enum', 'open'],
      ['due', 'date', today()],
      ['priority', 'number', undefined],
    ]);

    // done: dry-run shows the diff and writes nothing; the real run goes through the mutation path.
    const before = await readFile(file, 'utf8');
    const dry = await notes('todos', 'done', id, '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('-status: open\n+status: done');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect((await notes('todos', 'done', 'Ship')).stdout).toBe(`Updated ${path}\n`);
    expect(await readFile(file, 'utf8')).toContain('status: done');
    expect((await notes('todos', 'list', '--json')).stdout).toContain('"todos": []');

    // Unknown option and unknown subcommand are usage errors.
    expect((await notes('todos', 'list', '--bogus')).code).toBe(2);
    expect((await notes('todos', 'nope')).code).toBe(2);

    // A bad status is a field warning naming the allowed values; doctor still exits 0.
    await writeFile(
      join(root, 'later.md'),
      '---\nid: LATER\ntitle: Later\ntype: todo\nstatus: later\n---\n',
    );
    const doctor = await notes('doctor', '--json');
    expect(doctor.code).toBe(0);
    const { findings } = json<{
      findings: { kind: string; severity: string; details: Record<string, unknown> }[];
    }>(doctor);
    expect(findings.filter((f) => f.kind === 'field')).toEqual([
      expect.objectContaining({
        severity: 'warning',
        details: expect.objectContaining({
          path: 'later.md',
          field: 'status',
          allowed: ['open', 'done'],
        }) as unknown,
      }),
    ]);
    expect((await notes('doctor')).stdout).toContain('"status" must be one of open, done');

    const caps = json<{
      plugins: { name: string; enabled: boolean; commands: { name: string }[] }[];
    }>(await notes('capabilities', '--json'));
    expect(caps.plugins[0]).toMatchObject({
      name: 'todos',
      enabled: true,
      commands: [{ name: 'todos list' }, { name: 'todos done' }],
    });
  });

  it('refuses to open a vault that enables an unknown plugin (exit 6)', async () => {
    await appendFile(join(root, '.notes', 'config.yaml'), '  expenses: {}\n');
    const listing = await notes('list', '--json');
    expect(listing.code).toBe(6);
    expect(json<{ error: { details: unknown } }>(listing).error.details).toMatchObject({
      plugin: 'expenses',
      available: ['todos'],
    });
  });
});
