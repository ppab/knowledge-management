import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';

/*
 * The filesystem side of publishing: joining an output directory, turning one output file's path
 * into a relative link to another, and refusing a path that would escape the output tree. Pure
 * POSIX string logic so the domain never touches `node:path`.
 */

/** Resolves `.`/`..` segments lexically; keeps an absolute path absolute. */
const normalizeSegments = (path: string): string => {
  const isAbsolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  return (isAbsolute ? '/' : '') + out.join('/');
};

/**
 * The output directory for a publication: an absolute `output` passes through (normalized); a
 * relative one is joined onto the defining vault's root.
 */
export const resolveOutputDir = (root: string, output: string): string => {
  const normalized = output.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return normalizeSegments(normalized);
  return normalizeSegments(`${root.replace(/\/+$/, '')}/${normalized}`);
};

/**
 * A relative link from one output file to another: `a/b.md` → `a/c.md` is `./c.md`,
 * `a/b.md` → `x/c.md` is `../x/c.md`. Both paths are output-dir-relative POSIX paths.
 */
export const relativePath = (fromFile: string, toFile: string): string => {
  const from = fromFile.split('/').filter((segment) => segment !== '');
  const to = toFile.split('/').filter((segment) => segment !== '');
  from.pop();
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i += 1;
  const parts = [...from.slice(i).map(() => '..'), ...to.slice(i)];
  const rel = parts.join('/');
  return rel.startsWith('..') ? rel : `./${rel}`;
};

/**
 * Validates a destination-computed output path: relative, no `..`, naming a file. A destination
 * derives the path from a candidate's slug, so a hostile `slug:` is caught here before any write.
 */
export const normalizeOutputPath = (path: string): Result<string, AppError> => {
  const text = path.replace(/\\/g, '/');
  if (text.trim() === '') return err(validation('Output path must not be empty'));
  if (text.startsWith('/')) return err(validation('Output path must be relative', { path }));
  const out: string[] = [];
  for (const segment of text.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return err(validation('Output path must not contain ".."', { path }));
    out.push(segment);
  }
  if (out.length === 0) return err(validation('Output path must name a file', { path }));
  return ok(out.join('/'));
};

/** Escapes the characters that would break a Markdown link label (`[text](url)`). */
export const escapeMarkdownText = (text: string): string => text.replace(/([\\[\]])/g, '\\$1');
