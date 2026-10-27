import type { AppDeps } from '../application/ports.js';
import { createVaultRepository } from './filesystem/vault-repository.js';
import { createNoteStore } from './filesystem/note-store.js';
import { createUniqueSource } from './identity/unique-source.js';
import { createMarkdownParser } from './markdown/parser.js';
import { createSqliteIndexProvider } from './sqlite/note-index.js';
import { createTemplateRepository } from './templates/template-repository.js';
import { createFrontmatterCodec } from './yaml/frontmatter-codec.js';

/** Composition root for the real adapters. Interfaces call this once at startup. */
export const createDeps = (): AppDeps => ({
  clock: { now: () => new Date() },
  unique: createUniqueSource(),
  vaults: createVaultRepository(),
  notes: createNoteStore(),
  markdown: createMarkdownParser(),
  frontmatter: createFrontmatterCodec(),
  templates: createTemplateRepository(),
  indexes: createSqliteIndexProvider(),
});
