import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';
import { VAULT_DIR } from './vault.js';

/** The file behind a vault-relative path, for tools that need a real path (the editor). */
export const absoluteNotePath = (root: string, path: string): string =>
  `${root.replace(/[\\/]+$/, '')}/${path}`;

/**
 * Where a template's `template.path` lands: inside the notes directory (the first `include`
 * glob's literal prefix) unless it starts with `/`, which anchors it at the vault root instead.
 * The leading slash is consumed here so the result is an ordinary vault-relative path.
 */
export const resolveTemplatePath = (path: string, notesDir: string): string => {
  const text = path.replace(/\\/g, '/').trim();
  if (text.startsWith('/')) return text.replace(/^\/+/, '');
  return notesDir === '' || text === '' ? text : `${notesDir}/${text}`;
};

/**
 * Normalizes a user- or template-supplied path to a vault-relative POSIX path, refusing
 * anything that would escape the vault root or write into `.notes`. Pure string logic so the
 * application layer can enforce it without touching the filesystem.
 */
export const normalizeVaultPath = (input: string): Result<string, AppError> => {
  const text = input.replace(/\\/g, '/').trim();
  if (text === '') return err(validation('Path must not be empty'));
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text)) {
    return err(validation('Path must be relative to the vault root', { path: input }));
  }
  const out: string[] = [];
  for (const segment of text.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return err(validation('Path escapes the vault root', { path: input }));
      out.pop();
      continue;
    }
    out.push(segment);
  }
  if (out.length === 0) return err(validation('Path must name a file', { path: input }));
  if (out[0] === VAULT_DIR) {
    return err(validation(`Path must not be inside ${VAULT_DIR}/`, { path: input }));
  }
  return ok(out.join('/'));
};
