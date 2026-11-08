import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { createOutputStore } from './output-store.js';

describe('createOutputStore', () => {
  let dir: string;
  const store = createOutputStore();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'output-store-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates nested directories and writes the file', async () => {
    unwrap(await store.write(dir, 'a/b/c.md', 'hello'));
    expect(await readFile(join(dir, 'a/b/c.md'), 'utf8')).toBe('hello');
  });

  it('overwrites an existing file and leaves no temp files behind', async () => {
    unwrap(await store.write(dir, 'page.html', 'first'));
    unwrap(await store.write(dir, 'page.html', 'second'));
    expect(await readFile(join(dir, 'page.html'), 'utf8')).toBe('second');
    expect(await readdir(dir)).toEqual(['page.html']);
  });

  it('rejects a path that escapes the output directory', async () => {
    const result = await store.write(dir, '../escape.md', 'x');
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
