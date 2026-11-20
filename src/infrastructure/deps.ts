import type { AppDeps, ExternalEditor, FileWatcher } from '../application/ports.js';
import { createUserConfigRepository } from './config/user-config.js';
import { createExternalEditor } from './editor/external-editor.js';
import { createFileWatcher } from './watch/file-watcher.js';
import { createGitRevisionProvider } from './git/revision-provider.js';
import { createVaultRepository } from './filesystem/vault-repository.js';
import { createEntryStore } from './filesystem/entry-store.js';
import { createOutputStore } from './filesystem/output-store.js';
import { createUniqueSource } from './identity/unique-source.js';
import { createMarkdownParser } from './markdown/parser.js';
import { createSqliteIndexProvider } from './sqlite/entry-index.js';
import { createTemplateRepository } from './templates/template-repository.js';
import { createFrontmatterCodec } from './yaml/frontmatter-codec.js';

/** Composition root for the real adapters. Interfaces call this once at startup. */
export const createDeps = (): AppDeps => ({
  clock: { now: () => new Date() },
  unique: createUniqueSource(),
  vaults: createVaultRepository(),
  entries: createEntryStore(),
  markdown: createMarkdownParser(),
  frontmatter: createFrontmatterCodec(),
  templates: createTemplateRepository(),
  revisions: createGitRevisionProvider(),
  indexes: createSqliteIndexProvider(),
  userConfig: createUserConfigRepository(),
  outputs: createOutputStore(),
});

/** The interface-level ports: the editor (CLI `edit`, TUI `e`) and the watcher (TUI only). */
export const createInterfaceDeps = (): { editor: ExternalEditor; watcher: FileWatcher } => ({
  editor: createExternalEditor(),
  watcher: createFileWatcher(),
});
