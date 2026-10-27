import { createHash } from 'node:crypto';
import type {
  AppDeps,
  NoteStore,
  TemplateRepository,
  UserConfig,
  VaultRepository,
} from '../../src/application/ports.js';
import type { VaultHandle } from '../../src/application/vault/vault.js';
import { conflict, notFound, unavailable } from '../../src/domain/errors.js';
import { err, ok } from '../../src/domain/result.js';
import type { Scope, ScopeMember } from '../../src/domain/scope/scope.js';
import { asVaultId, defaultVaultConfig, type VaultConfig } from '../../src/domain/vault/vault.js';
import { createMarkdownParser } from '../../src/infrastructure/markdown/parser.js';
import { openSqlite } from '../../src/infrastructure/sqlite/driver.js';
import { createSqliteNoteIndex } from '../../src/infrastructure/sqlite/note-index.js';
import { createFrontmatterCodec } from '../../src/infrastructure/yaml/frontmatter-codec.js';
import { BUILTIN_DEFAULT_TEMPLATE } from '../../src/infrastructure/templates/template-repository.js';

/*
 * In-memory ports for application tests. The Markdown parser, YAML codec and SQLite index
 * (on an in-memory database) are pure and fast, so the real adapters are used; filesystem,
 * clock and randomness are faked. Every fake is keyed by vault root, so scope tests can hold
 * several vaults side by side.
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

export const createFakeNoteStore = (roots: Map<string, FakeFs>): NoteStore => {
  const fsOf = (root: string): FakeFs => {
    const fs = roots.get(root);
    if (!fs) throw new Error(`fake store: unknown vault root ${root}`);
    return fs;
  };
  return {
    list: (root, include) =>
      Promise.resolve(
        [...fsOf(root).files.entries()]
          .filter(([p]) => p.endsWith('.md') && include.length > 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([path, source]) => fingerprint(path, source)),
      ),
    read: (root, path) => {
      const source = fsOf(root).files.get(path);
      return Promise.resolve(
        source === undefined
          ? err(notFound(`No file at ${path}`, { path }))
          : ok({ ...fingerprint(path, source), source, version: version(source) }),
      );
    },
    write: (root, path, source, options = {}) => {
      const fs = fsOf(root);
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
  };
};

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
  snippets: Map<string, string>,
): TemplateRepository => ({
  getTemplate: (_root, name) => {
    const source =
      templates.get(name) ?? (name === 'default' ? BUILTIN_DEFAULT_TEMPLATE : undefined);
    return Promise.resolve(
      source === undefined ? err(notFound(`No template "${name}"`)) : ok({ name, source }),
    );
  },
  listTemplates: () => Promise.resolve([...new Set([...templates.keys(), 'default'])].sort()),
  getSnippet: (_root, name) => {
    const source = snippets.get(name);
    return Promise.resolve(
      source === undefined ? err(notFound(`No snippet "${name}"`)) : ok({ name, source }),
    );
  },
});

export interface Fixture {
  deps: AppDeps;
  /** The default vault at `/vault`, named `monitor`. */
  fs: FakeFs;
  vault: VaultHandle;
  /** The single-vault scope of the default vault. */
  scope: Scope;
  templates: Map<string, string>;
  snippets: Map<string, string>;
  vaults: Map<string, VaultConfig>;
  userConfig: { scopes: Record<string, { vaults: string[] }> };
  ids: string[];
  /** Registers another vault (own files, own index) and returns its handle. */
  addVault(
    root: string,
    name: string,
    overrides?: Partial<VaultConfig>,
  ): { fs: FakeFs; vault: VaultHandle };
  /** A scope over registered roots; a `{ root, reason }` entry is an unavailable member. */
  scopeOf(...members: (string | { root: string; reason: string })[]): Scope;
}

export const fixture = (overrides: Partial<VaultConfig> = {}): Fixture => {
  const roots = new Map<string, FakeFs>();
  const vaults = new Map<string, VaultConfig>();
  const databases = new Map<string, ReturnType<typeof openSqlite>>();
  const templates = new Map<string, string>();
  const snippets = new Map<string, string>();
  const userConfig: UserConfig & { scopes: Record<string, { vaults: string[] }> } = { scopes: {} };
  const ids = ['ID1', 'ID2', 'ID3', 'ID4'];
  let n = 0;

  const addVault = (root: string, name: string, vaultOverrides: Partial<VaultConfig> = {}) => {
    const fs: FakeFs = { files: new Map(), writes: [] };
    const config: VaultConfig = {
      ...defaultVaultConfig(asVaultId(name.toUpperCase()), name),
      ...vaultOverrides,
    };
    roots.set(root, fs);
    vaults.set(root, config);
    // One in-memory database per vault, shared by every open(): the index persists across
    // use cases exactly as the on-disk one does, so incremental refresh is exercised for real.
    databases.set(root, openSqlite(':memory:'));
    return { fs, vault: { root, config } };
  };

  const scopeOf = (...members: (string | { root: string; reason: string })[]): Scope => ({
    members: members.map((m): ScopeMember => {
      if (typeof m !== 'string') return { available: false, root: m.root, reason: m.reason };
      const config = vaults.get(m);
      if (!config) throw new Error(`fixture: unknown vault root ${m}`);
      return { available: true, root: m, vault: { root: m, config } };
    }),
  });

  const deps: AppDeps = {
    clock: { now: () => new Date(2026, 9, 27, 12, 0, 0) },
    unique: { ulid: () => ids[n++] ?? `ID${String(n)}`, uuidv7: () => `uuid-${String(++n)}` },
    vaults: createFakeVaultRepository(vaults),
    notes: createFakeNoteStore(roots),
    markdown: createMarkdownParser(),
    frontmatter: createFrontmatterCodec(),
    templates: createFakeTemplateRepository(templates, snippets),
    indexes: {
      open: (root) => {
        const database = databases.get(root);
        return Promise.resolve(
          database
            ? ok(createSqliteNoteIndex(database, { closeDriver: false }))
            : err(unavailable(`fake index: unknown vault root ${root}`)),
        );
      },
    },
    userConfig: {
      path: () => '/home/user/.config/notes/config.yaml',
      load: () => Promise.resolve(ok(userConfig)),
    },
  };

  const main = addVault('/vault', 'monitor', overrides);
  // Keep the historical id for the default vault.
  vaults.set('/vault', { ...main.vault.config, id: asVaultId('V1') });
  const vault = { root: '/vault', config: vaults.get('/vault') ?? main.vault.config };
  return {
    deps,
    fs: main.fs,
    vault,
    scope: scopeOf('/vault'),
    templates,
    snippets,
    vaults,
    userConfig,
    ids,
    addVault,
    scopeOf,
  };
};
