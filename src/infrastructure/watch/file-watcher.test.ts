import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileChange } from '../../application/ports.js';
import { createFileWatcher } from './file-watcher.js';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'notes-watch-'));
  await mkdir(join(root, '.notes', 'cache'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
});
afterAll(() => rm(root, { recursive: true, force: true }));

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('file watcher', () => {
  it('reports Markdown changes per tick and ignores dot directories and other files', async () => {
    const batches: FileChange[][] = [];
    const stop = await createFileWatcher({ tickMs: 100 }).watch([root], (c) =>
      batches.push([...c]),
    );
    try {
      await writeFile(join(root, 'docs', 'a.md'), 'a');
      await writeFile(join(root, 'docs', 'b.md'), 'b');
      await writeFile(join(root, '.notes', 'cache', 'index.sqlite'), 'db');
      await writeFile(join(root, 'docs', 'image.png'), 'png');
      await settle(600);
      expect(batches).toHaveLength(1);
      expect(batches[0]?.map((c) => c.path).sort()).toEqual(['docs/a.md', 'docs/b.md']);
      expect(batches[0]?.[0]?.root).toBe(root);

      await writeFile(join(root, 'docs', 'a.md'), 'a2');
      await settle(600);
      expect(batches).toHaveLength(2);
      expect(batches[1]).toEqual([{ root, path: 'docs/a.md' }]);
    } finally {
      await stop();
    }
  });
});
