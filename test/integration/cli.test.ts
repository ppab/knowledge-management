import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

const ofl = async (cwd: string, ...args: string[]): Promise<Outcome> => {
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

describe('ofl CLI (M1)', () => {
  it('init → create → list → show, with --json and exit codes', async () => {
    const init = await ofl(root, 'init', '--name', 'demo', '--json');
    expect(init.code).toBe(0);
    const config = JSON.parse(init.stdout) as { name: string; id: string };
    expect(config.name).toBe('demo');

    expect((await ofl(root, 'init')).code).toBe(6); // already a vault

    const created = await ofl(root, 'capture', '--title', 'Hello World', '--json');
    expect(created.code).toBe(0);
    const note = JSON.parse(created.stdout) as { id: string; path: string };
    expect(note.path).toBe('hello-world.md');

    const again = await ofl(root, 'capture', '--title', 'Hello World');
    expect(again.code).toBe(5);

    const list = await ofl(root, 'list', '--json');
    const listed = JSON.parse(list.stdout) as { entries: { id: string }[] };
    expect(listed.entries.map((n) => n.id)).toEqual([note.id]);

    const show = await ofl(join(root), 'show', 'hello world');
    expect(show.code).toBe(0);
    expect(show.stdout).toContain(`id: ${note.id}`);

    const missing = await ofl(root, 'show', 'nope', '--json');
    expect(missing.code).toBe(3);
    expect(JSON.parse(missing.stdout)).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('classify files a raw capture under a type and clears it back to the inbox', async () => {
    const box = await mkdtemp(join(tmpdir(), 'notes-classify-'));
    try {
      await ofl(box, 'init', '--name', 'demo', '--json');
      const created = await ofl(box, 'capture', '--title', 'Loose', '--json');
      const { id } = JSON.parse(created.stdout) as { id: string };
      const typeOf = async (): Promise<string | undefined> =>
        (JSON.parse((await ofl(box, 'show', id, '--json')).stdout) as { type?: string }).type;

      expect(await typeOf()).toBeUndefined(); // raw, unclassified
      expect((await ofl(box, 'classify', id, 'todo')).code).toBe(0);
      expect(await typeOf()).toBe('todo');
      expect((await ofl(box, 'classify', id, '--clear')).code).toBe(0);
      expect(await typeOf()).toBeUndefined();
      // Neither a type nor --clear: a validation error.
      expect((await ofl(box, 'classify', id)).code).toBe(6);
    } finally {
      await rm(box, { recursive: true, force: true });
    }
  });

  it('adopts an unidentified file without touching anything but the id', async () => {
    const original = '---\n# keep me\ntitle: Legacy # note\nextra: [1, 2]\n---\n\nBody [[X]]\n';
    await writeFile(join(root, 'legacy.md'), original);

    const list = await ofl(root, 'list', '--unidentified', '--json');
    const listed = JSON.parse(list.stdout) as { entries: { path: string; kind: string }[] };
    expect(listed.entries).toEqual([
      expect.objectContaining({ path: 'legacy.md', kind: 'unidentified' }),
    ]);

    const adopt = await ofl(root, 'adopt', 'legacy.md', '--json');
    expect(adopt.code).toBe(0);
    const { adopted } = JSON.parse(adopt.stdout) as { adopted: { id: string }[] };
    const after = await readFile(join(root, 'legacy.md'), 'utf8');
    expect(after).toBe(
      original.replace('extra: [1, 2]\n', `extra: [1, 2]\nid: ${adopted[0]!.id}\n`),
    );

    const raw = await ofl(root, 'show', 'Legacy', '--raw');
    expect(raw.stdout).toBe(after + '\n');
  });

  it('indexes references: search, backlinks, references, doctor, rebuild', async () => {
    const make = async (title: string, body: string) => {
      const res = await ofl(root, 'capture', '--title', title, '--json');
      expect(res.code).toBe(0);
      const { id, path } = JSON.parse(res.stdout) as { id: string; path: string };
      await writeFile(join(root, path), (await readFile(join(root, path), 'utf8')) + body);
      return id;
    };
    const alpha = await make('Alpha', 'Alpha mentions kumquats.\n');
    const beta = await make('Beta', `Beta points at [[${alpha}]] and [[${alpha}|label]].\n`);
    const gamma = await make('Gamma', `Gamma points at [[${beta}]] and [[MISSING]].\n`);

    const search = await ofl(root, 'search', 'kumquats', '--json');
    expect(search.code).toBe(0);
    const { hits } = JSON.parse(search.stdout) as { hits: { id: string; rankInVault: number }[] };
    expect(hits).toEqual([expect.objectContaining({ id: alpha, rankInVault: 1 })]);

    const back = await ofl(root, 'backlinks', 'alpha', '--json');
    const { backlinks } = JSON.parse(back.stdout) as { backlinks: { source: { id: string } }[] };
    expect(backlinks.map((b) => b.source.id)).toEqual([beta, beta]);

    const refs = await ofl(root, 'references', gamma);
    expect(refs.stdout).toContain(`[[${beta}]] -> Beta (beta.md)`);
    expect(refs.stdout).toContain('[[MISSING]] -> unresolved');

    const doctor = await ofl(root, 'doctor', '--json');
    expect(doctor.code).toBe(0); // a dangling reference is a warning, not an error
    const { findings } = JSON.parse(doctor.stdout) as {
      findings: { kind: string; details: { target: string } }[];
    };
    // legacy.md (previous test) references [[X]]; gamma references [[MISSING]].
    expect(findings.map((f) => [f.kind, f.details.target])).toEqual([
      ['dangling-reference', 'MISSING'],
      ['dangling-reference', 'X'],
    ]);

    // The cache is disposable: deleting it changes nothing observable.
    const before = await ofl(root, 'list', '--json');
    await rm(join(root, '.ofl', 'cache'), { recursive: true, force: true });
    expect((await ofl(root, 'list', '--json')).stdout).toBe(before.stdout);
    expect((await ofl(root, 'index', 'rebuild')).stdout).toMatch(/^Indexed 5 files/);

    // A duplicate id is an error: doctor exits 6 and show refuses to guess.
    await writeFile(join(root, 'dup.md'), `---\nid: ${alpha}\n---\n`);
    const status = await ofl(root, 'index', 'status');
    expect(status.stdout).toContain('stale: 1\n+ dup.md');
    const sick = await ofl(root, 'doctor', '--json');
    expect(sick.code).toBe(6);
    const report = JSON.parse(sick.stdout) as { ok: boolean; findings: { kind: string }[] };
    expect(report.ok).toBe(false);
    // `index status` above did not refresh, so doctor also reports the stale index.
    expect(report.findings.map((f) => f.kind)).toEqual([
      'stale-index',
      'duplicate-id',
      'dangling-reference',
      'dangling-reference',
    ]);
    expect(report.findings[1]).toMatchObject({
      details: { id: alpha, paths: ['alpha.md', 'dup.md'] },
    });
    expect((await ofl(root, 'show', alpha)).code).toBe(4);
    await rm(join(root, 'dup.md'));
    expect((await ofl(root, 'index', 'status')).stdout).toContain('- dup.md');
  });

  it('mutates safely: link, snippet insert, bind, dry-run and conflicts', async () => {
    const created = await ofl(root, 'capture', '--title', 'Mutable', '--json');
    const { id, path } = JSON.parse(created.stdout) as { id: string; path: string };
    const file = join(root, path);
    const original = await readFile(file, 'utf8');

    // Dry run: a diff on stdout, nothing written (mtime unchanged).
    const before = (await stat(file)).mtimeMs;
    const dry = await ofl(root, 'link', '--source', id, '--target', 'Alpha', '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain(`+++ b/${path}`);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect((await stat(file)).mtimeMs).toBe(before);

    // Real write resolves "Alpha" to its id and lands in a fresh References section.
    const alphaId = (
      JSON.parse((await ofl(root, 'show', 'Alpha', '--json')).stdout) as { id: string }
    ).id;
    expect(
      (await ofl(root, 'link', '--source', id, '--target', 'Alpha', '--at', 'references')).code,
    ).toBe(0);
    // The template ends with a blank line; the section is appended after the content, before it.
    // With no --label, the link defaults to the target's current title.
    expect(await readFile(file, 'utf8')).toBe(
      `${original.trimEnd()}\n\n## References\n\n[[${alphaId}|Alpha]]\n\n`,
    );
    const back = await ofl(root, 'backlinks', alphaId, '--json');
    const { backlinks } = JSON.parse(back.stdout) as { backlinks: { source: { id: string } }[] };
    expect(backlinks.map((b) => b.source.id)).toContain(id);

    // Snippet: missing variable is a validation error (exit 6); then a successful insert.
    await writeFile(join(root, '.ofl', 'snippets', 'todo.md'), '- [ ] {{task}} ({{date}})\n');
    expect((await ofl(root, 'snippet', 'insert', id, '--snippet', 'todo')).code).toBe(6);
    expect(
      (
        await ofl(
          root,
          'snippet',
          'insert',
          id,
          '--snippet',
          'todo',
          '--var',
          'task=ship',
          '--at',
          'heading:References',
        )
      ).code,
    ).toBe(0);
    expect(await readFile(file, 'utf8')).toMatch(
      /\[\[.*\]\]\n\n- \[ \] ship \(\d{4}-\d{2}-\d{2}\)\n\n$/,
    );

    // Bind twice yields one date; removing an absent one is a no-op with exit 0.
    expect((await ofl(root, 'bind', id, '--date', '2026-10-23')).code).toBe(0);
    expect((await ofl(root, 'bind', id, '--date', '2026-10-23')).stdout).toContain('No change');
    expect((await ofl(root, 'bind', id, '--date', '1999-01-01', '--remove')).code).toBe(0);
    const listed = await ofl(root, 'list', '--date', '2026-10-23', '--json');
    expect(
      (JSON.parse(listed.stdout) as { entries: { id: string }[] }).entries.map((n) => n.id),
    ).toEqual([id]);

    // Unknown heading → 3; bad date → 6; usage mistakes → 2.
    expect(
      (await ofl(root, 'link', '--source', id, '--target', alphaId, '--at', 'heading:Nope')).code,
    ).toBe(3);
    expect((await ofl(root, 'bind', id, '--date', 'tomorrow')).code).toBe(6);
    expect(
      (await ofl(root, 'link', '--source', id, '--target', alphaId, '--at', 'middle')).code,
    ).toBe(2);
  });

  it('relabels standalone links to show each target current title', async () => {
    const create = async (title: string) => {
      const r = await ofl(root, 'capture', '--title', title, '--json');
      expect(r.code).toBe(0);
      return JSON.parse(r.stdout) as { id: string; path: string };
    };
    const target = await create('Relabel Target');
    const source = await create('Relabel Source');
    // A hand-labelled standalone link, so relabel has something to rewrite.
    expect(
      (
        await ofl(
          root,
          'link',
          '--source',
          source.id,
          '--target',
          target.id,
          '--at',
          'references',
          '--label',
          'OldLabel',
        )
      ).code,
    ).toBe(0);
    const sfile = join(root, source.path);
    expect(await readFile(sfile, 'utf8')).toContain(`[[${target.id}|OldLabel]]`);

    // Dry run previews the new title and writes nothing.
    const dry = await ofl(root, 'relabel', source.id, '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain(`+[[${target.id}|Relabel Target]]`);
    expect(await readFile(sfile, 'utf8')).toContain('OldLabel');

    // The real relabel rewrites the label to the target's current title.
    expect((await ofl(root, 'relabel', source.id)).code).toBe(0);
    expect(await readFile(sfile, 'utf8')).toContain(`[[${target.id}|Relabel Target]]`);
    // (--all and the no-argument usage error are covered by relabel.test.ts without spawning.)
  });

  it('deletes a note, refusing while something links to it unless forced', async () => {
    const create = async (title: string) => {
      const r = await ofl(root, 'capture', '--title', title, '--json');
      expect(r.code).toBe(0);
      return JSON.parse(r.stdout) as { id: string; path: string };
    };
    const target = await create('Delete Target');
    const source = await create('Delete Source');
    expect((await ofl(root, 'link', '--source', source.id, '--target', target.id)).code).toBe(0);

    // A note something links to is kept unless --force; the error points the way.
    const blocked = await ofl(root, 'delete', target.id);
    expect(blocked.code).toBe(5);
    expect(blocked.stderr).toContain('--force');
    expect((await stat(join(root, target.path))).isFile()).toBe(true);

    // Forced, the file goes; an unversioned vault records nothing.
    const forced = await ofl(root, 'delete', target.id, '--force', '--json');
    expect(forced.code).toBe(0);
    const out = JSON.parse(forced.stdout) as { record: { kind: string }; path: string };
    expect(out.record.kind).toBe('unversioned');
    await expect(stat(join(root, target.path))).rejects.toThrow();

    // A note with nothing pointing at it needs no --force.
    expect((await ofl(root, 'delete', source.id)).code).toBe(0);
    expect((await ofl(root, 'show', source.id)).code).toBe(3);
  });

  it('runs from a nested directory and fails clearly outside a vault', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'notes-outside-'));
    try {
      const res = await ofl(outside, 'list');
      expect(res.code).toBe(3);
      expect(res.stderr).toContain('No vault found');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    expect((await ofl(root, '--cwd', root, 'list')).code).toBe(0);
    expect((await ofl(root, 'bogus')).code).toBe(2);
  });
});
