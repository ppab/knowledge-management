import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { unavailable, validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { OutputStore } from '../../application/ports.js';

/**
 * Writes publication output. Unlike the note store this has no `.notes` reservation and no
 * symlink hardening: the output directory is a destination the user chose, not the vault. It
 * still refuses a `path` that escapes `dir` (defense in depth against a hostile route/slug),
 * creates parent directories, and writes atomically via a temp file and rename.
 */
export const createOutputStore = (): OutputStore => ({
  async write(dir, path, content): Promise<Result<void, AppError>> {
    const absoluteDir = resolve(dir);
    const target = resolve(absoluteDir, path);
    const rel = relative(absoluteDir, target);
    if (rel === '' || rel.startsWith('..') || rel.split(sep)[0] === '..') {
      return err(validation(`Output path ${path} is outside the output directory`, { path }));
    }
    let temp: string | undefined;
    try {
      await mkdir(dirname(target), { recursive: true });
      temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temp, content, 'utf8');
      await rename(temp, target);
      return ok(undefined);
    } catch (cause) {
      if (temp !== undefined) await unlink(temp).catch(() => undefined);
      return err(unavailable(`Cannot write ${path}`, { path, cause: String(cause) }));
    }
  },
});
