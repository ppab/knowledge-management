import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound, unavailable, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import { VAULT_DIR } from '../../domain/vault/vault.js';
import type { TemplateRepository, TemplateSource } from '../../application/ports.js';

export const DEFAULT_TEMPLATE_NAME = 'default';

/** Used when the vault has no `.notes/templates/default.md`. Writes to the first include dir. */
/** Binds every new note to its creation day, so it shows in the calendar (docs/plan.md M7). */
export const BUILTIN_DEFAULT_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
dates: ["{{date}}"]
---

# {{title}}

`;

const templatesDir = (root: string): string => join(root, VAULT_DIR, 'templates');
const snippetsDir = (root: string): string => join(root, VAULT_DIR, 'snippets');

const errno = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined;

const readNamed = async (
  kind: 'template' | 'snippet',
  dir: string,
  name: string,
): Promise<Result<TemplateSource, AppError>> => {
  // One directory level is allowed so a vault can override a plugin's `<plugin>/<name>`.
  if (!/^[\w.-]+(?:\/[\w.-]+)?$/.test(name)) {
    return err(notFound(`Invalid ${kind} name "${name}"`, { name }));
  }
  try {
    return ok({ name, source: await readFile(join(dir, `${name}.md`), 'utf8') });
  } catch (cause) {
    return errno(cause) === 'ENOENT'
      ? err(notFound(`No ${kind} "${name}" in ${VAULT_DIR}/${kind}s/`, { name }))
      : err(unavailable(`Cannot read ${kind} "${name}"`, { name, cause: String(cause) }));
  }
};

export const createTemplateRepository = (): TemplateRepository => ({
  async getTemplate(root, name) {
    const read = await readNamed('template', templatesDir(root), name);
    if (!read.ok && read.error.code === 'NOT_FOUND' && name === DEFAULT_TEMPLATE_NAME) {
      return ok({ name, source: BUILTIN_DEFAULT_TEMPLATE });
    }
    return read;
  },

  getSnippet: (root, name) => readNamed('snippet', snippetsDir(root), name),

  async listTemplates(root) {
    try {
      const files = await readdir(templatesDir(root));
      const names = files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
      if (!names.includes(DEFAULT_TEMPLATE_NAME)) names.push(DEFAULT_TEMPLATE_NAME);
      return names.sort();
    } catch {
      return [DEFAULT_TEMPLATE_NAME];
    }
  },
});
