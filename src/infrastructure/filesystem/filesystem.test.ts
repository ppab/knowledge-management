import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { asVaultId, defaultVaultConfig } from '../../domain/vault/vault.js';
import { createNoteStore } from './note-store.js';
import { createVaultRepository } from './vault-repository.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'notes-fs-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('vault repository', () => {
  const vaults = createVaultRepository();

  it('creates .notes with a self-ignoring cache and finds the nearest vault', async () => {
    const config = defaultVaultConfig(asVaultId('V1'), 'test');
    unwrap(await vaults.create(root, config));
    expect((await readdir(join(root, '.notes'))).sort()).toEqual([
      'cache',
      'config.yaml',
      'snippets',
      'templates',
    ]);
    expect(await readFile(join(root, '.notes', 'cache', '.gitignore'), 'utf8')).toBe('*\n');
    expect(unwrap(await vaults.load(root))).toEqual(config);

    await mkdir(join(root, 'a', 'b'), { recursive: true });
    expect(await vaults.findNearest(join(root, 'a', 'b'))).toBe(root);
    expect(await vaults.findNearest(tmpdir())).toBeNull();

    // A notes directory named by `include` is created with the vault.
    const nested = join(root, 'nested');
    await mkdir(nested);
    unwrap(await vaults.create(nested, { ...config, include: ['journal/**/*.md'] }));
    expect((await readdir(nested)).sort()).toEqual(['.notes', 'journal']);
  });

  it('rejects invalid configuration with details', async () => {
    await mkdir(join(root, '.notes'));
    await writeFile(join(root, '.notes', 'config.yaml'), 'vault:\n  name: x\n');
    const loaded = await vaults.load(root);
    expect(loaded).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    await writeFile(
      join(root, '.notes', 'config.yaml'),
      'vault: {id: v, name: x}\nidentity: {strategy: formatted, format: "{vault}"}\n',
    );
    expect(await vaults.load(root)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('note store', () => {
  const store = createNoteStore();

  it('lists by include/exclude globs and never looks inside .notes', async () => {
    await mkdir(join(root, 'docs', 'sub'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, '.notes', 'templates'), { recursive: true });
    for (const p of [
      'docs/a.md',
      'docs/sub/b.md',
      'docs/c.txt',
      'node_modules/pkg/r.md',
      '.notes/templates/t.md',
      'top.md',
    ]) {
      await writeFile(join(root, p), p);
    }
    const listed = await store.list(root, ['**/*.md'], ['node_modules/**']);
    expect(listed.map((f) => f.path)).toEqual(['docs/a.md', 'docs/sub/b.md', 'top.md']);
    expect(listed[0]).toMatchObject({
      size: 'docs/a.md'.length,
      mtime: expect.any(Number) as number,
    });
    expect((await store.list(root, ['docs/**/*.md'], [])).map((f) => f.path)).toEqual([
      'docs/a.md',
      'docs/sub/b.md',
    ]);
    const doc = unwrap(await store.read(root, 'top.md'));
    expect(doc).toMatchObject({ size: 6, mtime: listed[2]!.mtime });
  });

  it('writes atomically, creates directories and leaves no temp files', async () => {
    unwrap(await store.write(root, 'deep/dir/n.md', 'hello'));
    expect(await readFile(join(root, 'deep', 'dir', 'n.md'), 'utf8')).toBe('hello');
    expect(await readdir(join(root, 'deep', 'dir'))).toEqual(['n.md']);
    const doc = unwrap(await store.read(root, 'deep/dir/n.md'));
    expect(doc.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects concurrent modification and refuses to clobber on createOnly', async () => {
    const first = unwrap(await store.write(root, 'n.md', 'v1'));
    await writeFile(join(root, 'n.md'), 'someone else');
    const stale = await store.write(root, 'n.md', 'v2', { expectedVersion: first.version });
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await readFile(join(root, 'n.md'), 'utf8')).toBe('someone else');

    const clash = await store.write(root, 'n.md', 'v3', { createOnly: true });
    expect(clash).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await readdir(root)).toEqual(['n.md']);
  });

  it('lets the first of two readers win and the second see a conflict', async () => {
    unwrap(await store.write(root, 'n.md', 'base'));
    const reader1 = unwrap(await store.read(root, 'n.md'));
    const reader2 = unwrap(await store.read(root, 'n.md'));
    unwrap(await store.write(root, 'n.md', 'from 1', { expectedVersion: reader1.version }));
    const second = await store.write(root, 'n.md', 'from 2', { expectedVersion: reader2.version });
    expect(second).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await readFile(join(root, 'n.md'), 'utf8')).toBe('from 1');
  });

  it('refuses paths outside the note area even if a caller bypassed normalization', async () => {
    expect(await store.write(root, '../escape.md', 'x')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await store.read(root, '.notes/config.yaml')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await store.read(root, 'missing.md')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('note store concurrency', () => {
  const store = createNoteStore();

  it('serializes two concurrent writers on the same version so one conflicts, not clobbers', async () => {
    const base = unwrap(await store.write(root, 'n.md', 'base'));
    // Both writers read the same version and race. The per-path lock serializes them: the first to
    // the lock renames, the second re-reads inside the lock, sees the winner's version and
    // conflicts. Deterministic regardless of scheduling — exactly one of each, never a lost update.
    const [a, b] = await Promise.all([
      store.write(root, 'n.md', 'from A', { expectedVersion: base.version }),
      store.write(root, 'n.md', 'from B', { expectedVersion: base.version }),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok)).toHaveLength(1);
    expect(outcomes.find((r) => !r.ok)).toMatchObject({ error: { code: 'CONFLICT' } });
    // The surviving file is exactly one writer's content — never a torn or merged write.
    expect(['from A', 'from B']).toContain(await readFile(join(root, 'n.md'), 'utf8'));
  });

  it('refuses a conditional write whose source was deleted after it was read', async () => {
    const first = unwrap(await store.write(root, 'n.md', 'base'));
    await rm(join(root, 'n.md'));
    const gone = await store.write(root, 'n.md', 'next', { expectedVersion: first.version });
    // Deletion is a conflict, not a silent re-create: the version the caller expected is gone.
    expect(gone).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await readdir(root)).toEqual([]); // nothing recreated
  });

  it('leaves no temp artifacts behind when a conditional write conflicts', async () => {
    const first = unwrap(await store.write(root, 'n.md', 'v1'));
    await writeFile(join(root, 'n.md'), 'changed out from under us');
    const stale = await store.write(root, 'n.md', 'v2', { expectedVersion: first.version });
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    // The staged temp was cleaned up: only the real file remains, no `*.tmp` residue.
    expect(await readdir(root)).toEqual(['n.md']);
    expect(await readFile(join(root, 'n.md'), 'utf8')).toBe('changed out from under us');
  });

  it('serializes a burst of unconditional writers to the last-wins content with no residue', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.write(root, 'n.md', `w${String(i)}`)),
    );
    // No expectedVersion, so every write is allowed; the lock still serializes them so the file is
    // one writer's whole content and the directory is left clean.
    const survivor = await readFile(join(root, 'n.md'), 'utf8');
    expect(survivor).toMatch(/^w[0-7]$/);
    expect(await readdir(root)).toEqual(['n.md']);
  });
});

describe('note store symlink containment', () => {
  const store = createNoteStore();
  let external: string;
  beforeEach(async () => {
    external = await mkdtemp(join(tmpdir(), 'notes-ext-'));
    await mkdir(join(root, '.notes'), { recursive: true });
  });
  afterEach(() => rm(external, { recursive: true, force: true }));

  /** Creates a symlink, or returns false on a platform/filesystem that forbids them (explicit skip). */
  const linked = async (target: string, path: string): Promise<boolean> => {
    try {
      await symlink(target, path);
      return true;
    } catch {
      return false; // e.g. Windows without privilege: the test is skipped, not failed.
    }
  };

  it('rejects reads and writes through a symlink that escapes the vault', async () => {
    await writeFile(join(external, 'secret.md'), 'secret');
    if (!(await linked(join(external, 'secret.md'), join(root, 'leak.md')))) return;
    expect(await store.read(root, 'leak.md')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await store.write(root, 'leak.md', 'hacked')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await readFile(join(external, 'secret.md'), 'utf8')).toBe('secret'); // untouched
  });

  it('rejects access through a symlinked ancestor directory', async () => {
    if (!(await linked(external, join(root, 'out')))) return;
    await writeFile(join(external, 'x.md'), 'ext');
    expect(await store.read(root, 'out/x.md')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await store.write(root, 'out/new.md', 'y')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await readdir(external)).toEqual(['x.md']); // no file created outside the vault
  });

  it('follows an internal symlink and writes through to its target, preserving the link', async () => {
    unwrap(await store.write(root, 'real.md', 'original'));
    if (!(await linked(join(root, 'real.md'), join(root, 'alias.md')))) return;
    const doc = unwrap(await store.read(root, 'alias.md'));
    expect(doc.source).toBe('original');
    expect(doc.physicalKey).toBe('real.md');
    unwrap(await store.write(root, 'alias.md', 'updated'));
    expect(await readFile(join(root, 'real.md'), 'utf8')).toBe('updated');
    expect((await lstat(join(root, 'alias.md'))).isSymbolicLink()).toBe(true); // link preserved
  });

  it('rejects a symlink that resolves into the reserved .notes area', async () => {
    await writeFile(join(root, '.notes', 'config.yaml'), 'x');
    if (!(await linked(join(root, '.notes', 'config.yaml'), join(root, 'sneak.md')))) return;
    expect(await store.read(root, 'sneak.md')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('treats a dangling symlink as not found to read, validation to write, conflict to create', async () => {
    if (!(await linked(join(root, 'nowhere.md'), join(root, 'dangling.md')))) return;
    expect(await store.read(root, 'dangling.md')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await store.write(root, 'dangling.md', 'x')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await store.write(root, 'dangling.md', 'x', { createOnly: true })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });

  it('rejects a symlink loop as validation, never as missing', async () => {
    if (!(await linked(join(root, 'b.md'), join(root, 'a.md')))) return;
    if (!(await linked(join(root, 'a.md'), join(root, 'b.md')))) return;
    expect(await store.read(root, 'a.md')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('reports real-path keys and never lists files from a symlinked directory that escapes', async () => {
    unwrap(await store.write(root, 'note.md', 'hi'));
    await writeFile(join(external, 'ext.md'), 'ext');
    if (!(await linked(external, join(root, 'escape')))) return;
    const listed = await store.list(root, ['**/*.md'], []);
    expect(listed.map((f) => f.path)).toEqual(['note.md']); // escape/ext.md filtered out
    expect(listed[0]!.physicalKey).toBe('note.md');
  });
});
