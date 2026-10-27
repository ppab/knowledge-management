import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    expect(await store.list(root, ['**/*.md'], ['node_modules/**'])).toEqual([
      'docs/a.md',
      'docs/sub/b.md',
      'top.md',
    ]);
    expect(await store.list(root, ['docs/**/*.md'], [])).toEqual(['docs/a.md', 'docs/sub/b.md']);
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
