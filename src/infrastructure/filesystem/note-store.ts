import { createHash, randomBytes } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { glob } from 'tinyglobby';
import { conflict, notFound, unavailable, validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import { VAULT_DIR } from '../../domain/vault/vault.js';
import type { NoteDocument, NoteStore } from '../../application/ports.js';

export const contentVersion = (source: string): string =>
  createHash('sha256').update(source).digest('hex');

const errno = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined;

/** Defense in depth: the domain already normalizes paths, but never trust a caller. */
const resolveInside = (root: string, path: string): Result<string, AppError> => {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, absolute);
  if (rel === '' || rel.startsWith('..') || rel.split(sep)[0] === VAULT_DIR) {
    return err(validation(`Path ${path} is outside the vault's note area`, { path }));
  }
  return ok(absolute);
};

/** Writes atomically: content lands in a sibling temp file, then moves into place. */
const writeTemp = async (target: string, source: string): Promise<string> => {
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, source, 'utf8');
  return temp;
};

export const createNoteStore = (): NoteStore => ({
  async list(root, include, exclude) {
    const paths = await glob([...include], {
      cwd: root,
      ignore: [...exclude, `${VAULT_DIR}/**`],
      onlyFiles: true,
      dot: false,
    });
    return paths.sort();
  },

  async read(root, path): Promise<Result<NoteDocument, AppError>> {
    const absolute = resolveInside(root, path);
    if (!absolute.ok) return absolute;
    try {
      const source = await readFile(absolute.value, 'utf8');
      return ok({ path, source, version: contentVersion(source) });
    } catch (cause) {
      return errno(cause) === 'ENOENT'
        ? err(notFound(`No file at ${path}`, { path }))
        : err(unavailable(`Cannot read ${path}`, { path, cause: String(cause) }));
    }
  },

  async write(root, path, source, options = {}) {
    const absolute = resolveInside(root, path);
    if (!absolute.ok) return absolute;
    const target = absolute.value;
    const version = contentVersion(source);

    if (options.expectedVersion !== undefined) {
      const current = await this.read(root, path);
      if (!current.ok) {
        return current.error.code === 'NOT_FOUND'
          ? err(conflict(`${path} was deleted since it was read`, { path }))
          : current;
      }
      if (current.value.version !== options.expectedVersion) {
        return err(
          conflict(`${path} was modified since it was read`, {
            path,
            expectedVersion: options.expectedVersion,
            currentVersion: current.value.version,
          }),
        );
      }
    }

    let temp: string | undefined;
    try {
      temp = await writeTemp(target, source);
      if (options.createOnly) {
        // link() fails with EEXIST if the target exists: an atomic create-if-absent.
        await link(temp, target);
        await unlink(temp);
      } else {
        await rename(temp, target);
      }
      return ok({ version });
    } catch (cause) {
      if (temp !== undefined) await unlink(temp).catch(() => undefined);
      return errno(cause) === 'EEXIST'
        ? err(conflict(`${path} already exists`, { path }))
        : err(unavailable(`Cannot write ${path}`, { path, cause: String(cause) }));
    }
  },
});
