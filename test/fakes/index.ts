import { createHash } from 'node:crypto';
import type {
  AppDeps,
  NoteStore,
  TemplateRepository,
  VaultRepository,
} from '../../src/application/ports.js';
import type { VaultHandle } from '../../src/application/vault/vault.js';
import { conflict, notFound, unavailable } from '../../src/domain/errors.js';
import { err, ok } from '../../src/domain/result.js';
import { asVaultId, defaultVaultConfig, type VaultConfig } from '../../src/domain/vault/vault.js';
import { createMarkdownParser } from '../../src/infrastructure/markdown/parser.js';
import { openSqlite } from '../../src/infrastructure/sqlite/driver.js';
import { createSqliteNoteIndex } from '../../src/infrastructure/sqlite/note-index.js';
import { createFrontmatterCodec } from '../../src/infrastructure/yaml/frontmatter-codec.js';
import { BUILTIN_DEFAULT_TEMPLATE } from '../../src/infrastructure/templates/template-repository.js';

/*
 * In-memory ports for application tests. The Markdown parser, YAML codec and SQLite index
 * (on an in-memory database) are pure and fast, so the real adapters are used; filesystem,
 * clock and randomness are faked.
 */

const version = (source: string) => createHash('sha256').update(source).digest('hex');
/** A content-derived "mtime": any edit to the fake file changes it, like a real clock would. */
const fingerprint = (path: string, source: string) => ({
  path,
  mtime: parseInt(version(source).slice(0, 10), 16),
  size: source.length,
});

export interface FakeFs {
  files: Map<string, string>;
  writes: { path: string; source: string }[];
}

export const createFakeNoteStore = (fs: FakeFs): NoteStore => ({
  list: (_root, include) =>
    Promise.resolve(
      [...fs.files.entries()]
        .filter(([p]) => p.endsWith('.md') && include.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, source]) => fingerprint(path, source)),
    ),
  read: (_root, path) => {
    const source = fs.files.get(path);
    return Promise.resolve(
      source === undefined
        ? err(notFound(`No file at ${path}`, { path }))
        : ok({ ...fingerprint(path, source), source, version: version(source) }),
    );
  },
  write: (_root, path, source, options = {}) => {
    const current = fs.files.get(path);
    if (options.createOnly && current !== undefined) {
      return Promise.resolve(err(conflict(`${path} already exists`, { path })));
    }
    if (options.expectedVersion !== undefined) {
      if (current === undefined) return Promise.resolve(err(conflict(`${path} deleted`)));
      if (version(current) !== options.expectedVersion) {
        return Promise.resolve(err(conflict(`${path} modified`, { path })));
      }
    }
    fs.files.set(path, source);
    fs.writes.push({ path, source });
    return Promise.resolve(ok({ version: version(source) }));
  },
});

export const createFakeVaultRepository = (vaults: Map<string, VaultConfig>): VaultRepository => ({
  findNearest: (cwd) => {
    const root = [...vaults.keys()]
      .filter((r) => cwd === r || cwd.startsWith(r + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return Promise.resolve(root ?? null);
  },
  exists: (root) => Promise.resolve(vaults.has(root)),
  load: (root) => {
    const config = vaults.get(root);
    return Promise.resolve(config ? ok(config) : err(unavailable(`no vault at ${root}`)));
  },
  create: (root, config) => {
    vaults.set(root, config);
    return Promise.resolve(ok(undefined));
  },
});

export const createFakeTemplateRepository = (
  templates: Map<string, string>,
): TemplateRepository => ({
  getTemplate: (_root, name) => {
    const source =
      templates.get(name) ?? (name === 'default' ? BUILTIN_DEFAULT_TEMPLATE : undefined);
    return Promise.resolve(
      source === undefined ? err(notFound(`No template "${name}"`)) : ok({ name, source }),
    );
  },
  listTemplates: () => Promise.resolve([...new Set([...templates.keys(), 'default'])].sort()),
});

export interface Fixture {
  deps: AppDeps;
  fs: FakeFs;
  vault: VaultHandle;
  templates: Map<string, string>;
  vaults: Map<string, VaultConfig>;
  ids: string[];
}

export const fixture = (overrides: Partial<VaultConfig> = {}): Fixture => {
  const fs: FakeFs = { files: new Map(), writes: [] };
  const templates = new Map<string, string>();
  const config: VaultConfig = { ...defaultVaultConfig(asVaultId('V1'), 'monitor'), ...overrides };
  const vaults = new Map([['/vault', config]]);
  const ids = ['ID1', 'ID2', 'ID3', 'ID4'];
  let n = 0;
  // One in-memory database per fixture, shared by every open(): the index persists across
  // use cases exactly as the on-disk one does, so incremental refresh is exercised for real.
  const database = openSqlite(':memory:');
  const deps: AppDeps = {
    clock: { now: () => new Date(2026, 9, 27, 12, 0, 0) },
    unique: { ulid: () => ids[n++] ?? `ID${String(n)}`, uuidv7: () => `uuid-${String(++n)}` },
    vaults: createFakeVaultRepository(vaults),
    notes: createFakeNoteStore(fs),
    markdown: createMarkdownParser(),
    frontmatter: createFrontmatterCodec(),
    templates: createFakeTemplateRepository(templates),
    indexes: {
      open: () => Promise.resolve(ok(createSqliteNoteIndex(database, { closeDriver: false }))),
    },
  };
  return { deps, fs, vault: { root: '/vault', config }, templates, vaults, ids };
};
