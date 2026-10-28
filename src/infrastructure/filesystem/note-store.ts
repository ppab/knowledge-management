import { createHash, randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { glob } from 'tinyglobby';
import { conflict, notFound, unavailable, validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import { VAULT_DIR } from '../../domain/vault/vault.js';
import type { NoteDocument, NoteFile, NoteStore } from '../../application/ports.js';

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

/**
 * Whether a resolved real path lies outside the vault's note area — either beyond the real root
 * or inside the reserved `.notes` directory. `allowRoot` lets a parent directory *be* the root;
 * a file target may not.
 */
const outside = (realRoot: string, real: string, allowRoot: boolean): boolean => {
  const rel = relative(realRoot, real);
  if (rel === '') return !allowRoot;
  return rel.startsWith('..') || rel.split(sep)[0] === VAULT_DIR;
};

/** The opaque physical-target key: a vault-relative, POSIX-normalized real path. */
const toKey = (realRoot: string, real: string): string =>
  relative(realRoot, real).split(sep).join('/');

/** The real vault root, with every symlink in the root path itself resolved. */
const realRootOf = (root: string): Promise<string> => realpath(root).catch(() => resolve(root));

/** Climbs to the deepest existing ancestor of `absolute` and returns its real path. */
const realAncestor = async (absolute: string): Promise<Result<string, AppError>> => {
  let probe = dirname(absolute);
  for (;;) {
    try {
      return ok(await realpath(probe));
    } catch (cause) {
      const code = errno(cause);
      if (code === 'ELOOP') return err(validation(`Path ${absolute} is a symlink loop`));
      if (code !== 'ENOENT') {
        return err(unavailable(`Cannot resolve ${absolute}`, { cause: String(cause) }));
      }
      const up = dirname(probe);
      if (up === probe) return err(unavailable(`Cannot resolve ${absolute}`));
      probe = up;
    }
  }
};

interface Located {
  /** The lexical absolute path, used for reads and for creating new files. */
  readonly absolute: string;
  /** Set when the target exists and is contained; the canonical real path to write through. */
  readonly physicalKey?: string;
  /** The final component is a symlink whose target does not exist. */
  readonly dangling: boolean;
}

/**
 * Resolves a vault-relative path against the *real* vault root, defeating symlink escape. The
 * lexical check runs first; then the real target (or, when missing, the deepest existing
 * ancestor) must stay inside the vault and out of `.notes`. A symlink loop is a `VALIDATION`
 * failure, never treated as missing.
 */
const locate = async (
  realRoot: string,
  root: string,
  path: string,
): Promise<Result<Located, AppError>> => {
  const lexical = resolveInside(root, path);
  if (!lexical.ok) return lexical;
  const absolute = lexical.value;
  try {
    const real = await realpath(absolute);
    if (outside(realRoot, real, false)) {
      return err(validation(`Path ${path} resolves outside the vault's note area`, { path }));
    }
    return ok({ absolute, physicalKey: toKey(realRoot, real), dangling: false });
  } catch (cause) {
    const code = errno(cause);
    if (code === 'ELOOP') return err(validation(`Path ${path} is a symlink loop`, { path }));
    if (code !== 'ENOENT') {
      return err(unavailable(`Cannot resolve ${path}`, { path, cause: String(cause) }));
    }
    // The target itself is missing. Tell a dangling symlink apart from a plain missing file,
    // and validate the deepest existing ancestor so creation cannot reach outside the vault.
    let dangling = false;
    try {
      dangling = (await lstat(absolute)).isSymbolicLink();
    } catch {
      // Not even a dir entry: a plain missing path.
    }
    const ancestor = await realAncestor(absolute);
    if (!ancestor.ok) return ancestor;
    if (outside(realRoot, ancestor.value, true)) {
      return err(validation(`Path ${path} resolves outside the vault's note area`, { path }));
    }
    return ok({ absolute, dangling });
  }
};

export const createNoteStore = (): NoteStore => ({
  async list(root, include, exclude) {
    const realRoot = await realRootOf(root);
    const paths = await glob([...include], {
      cwd: root,
      ignore: [...exclude, `${VAULT_DIR}/**`],
      onlyFiles: true,
      dot: false,
      // tinyglobby cannot prune only the unsafe symlinked directories (the option is all-or
      // -nothing), so we keep following links and filter escaping targets out of the results
      // below. External directories are still traversed; they just never enter discovery.
    });
    const files: NoteFile[] = [];
    for (const path of paths.sort()) {
      try {
        const real = await realpath(resolve(root, path));
        if (outside(realRoot, real, false)) continue; // a symlink leaving the vault
        const s = await stat(real);
        files.push({ path, mtime: s.mtimeMs, size: s.size, physicalKey: toKey(realRoot, real) });
      } catch {
        // Deleted or dangling between glob and stat: it simply is not there.
      }
    }
    return files;
  },

  async read(root, path): Promise<Result<NoteDocument, AppError>> {
    const realRoot = await realRootOf(root);
    const located = await locate(realRoot, root, path);
    if (!located.ok) return located;
    try {
      // Fingerprint first: if the file changes between the two calls, the next refresh re-reads.
      const s = await stat(located.value.absolute);
      const source = await readFile(located.value.absolute, 'utf8');
      return ok({
        path,
        source,
        version: contentVersion(source),
        mtime: s.mtimeMs,
        size: s.size,
        ...(located.value.physicalKey !== undefined && { physicalKey: located.value.physicalKey }),
      });
    } catch (cause) {
      return errno(cause) === 'ENOENT'
        ? err(notFound(`No file at ${path}`, { path }))
        : err(unavailable(`Cannot read ${path}`, { path, cause: String(cause) }));
    }
  },

  async write(root, path, source, options = {}) {
    const realRoot = await realRootOf(root);
    const located = await locate(realRoot, root, path);
    if (!located.ok) return located;
    // A normal write must never create through a dangling symlink (its target could be anywhere).
    // `createOnly` falls through: the link below fails `EEXIST` on the symlink and so conflicts.
    if (located.value.dangling && !options.createOnly) {
      return err(validation(`${path} is a dangling symlink`, { path }));
    }
    // Write through to the canonical real path when the file exists, so an internal symlink is
    // preserved rather than replaced; create new files at the lexical path.
    const target =
      located.value.physicalKey !== undefined
        ? join(realRoot, ...located.value.physicalKey.split('/'))
        : located.value.absolute;
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
      await mkdir(dirname(target), { recursive: true });
      // Re-check the parent after creating it: an ancestor swapped for a symlink during `mkdir`
      // must not let the write land outside the vault. A residual window remains between this
      // check and the move below, and directories already created cannot be undone here — both
      // are accepted platform limitations within the stated threat model.
      const parentReal = await realpath(dirname(target));
      if (outside(realRoot, parentReal, true)) {
        return err(validation(`${path} resolves outside the vault's note area`, { path }));
      }
      temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temp, source, 'utf8');
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
