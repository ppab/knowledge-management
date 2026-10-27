import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound, unavailable } from '../../domain/errors.js';
import { err, ok } from '../../domain/result.js';
import { VAULT_DIR } from '../../domain/vault/vault.js';
import type { TemplateRepository } from '../../application/ports.js';

export const DEFAULT_TEMPLATE_NAME = 'default';

/** Used when the vault has no `.notes/templates/default.md`. Writes to the first include dir. */
export const BUILTIN_DEFAULT_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
---

# {{title}}

`;

const templatesDir = (root: string): string => join(root, VAULT_DIR, 'templates');

const errno = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined;

export const createTemplateRepository = (): TemplateRepository => ({
  async getTemplate(root, name) {
    if (!/^[\w.-]+$/.test(name)) {
      return err(notFound(`Invalid template name "${name}"`, { name }));
    }
    try {
      const source = await readFile(join(templatesDir(root), `${name}.md`), 'utf8');
      return ok({ name, source });
    } catch (cause) {
      if (errno(cause) !== 'ENOENT') {
        return err(unavailable(`Cannot read template "${name}"`, { name, cause: String(cause) }));
      }
      if (name === DEFAULT_TEMPLATE_NAME) return ok({ name, source: BUILTIN_DEFAULT_TEMPLATE });
      return err(notFound(`No template "${name}" in ${VAULT_DIR}/templates/`, { name }));
    }
  },

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
