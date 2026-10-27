import { createHash } from 'node:crypto';
import type {
  AppDeps,
  NoteStore,
  RevisionProvider,
  TemplateRepository,
  UserConfig,
  VaultRepository,
} from '../../src/application/ports.js';
import type { VaultHandle } from '../../src/application/vault/vault.js';
import { appError, conflict, notFound, unavailable } from '../../src/domain/errors.js';
import { err, ok } from '../../src/domain/result.js';
import type { Revision } from '../../src/domain/revision/revision.js';
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

export interface FakeRevisions extends RevisionProvider {
  /** Marks `root` as versioned; until then its status is `unversioned`. */
  enable(root: string): void;
  /** Records a revision holding `source` without touching the file. */
  seed(root: string, path: string, source: string, summary?: string): Revision;
  /** Makes the next `record` fail the way a rejecting pre-commit hook does. */
  rejectNext(output: string): void;
  readonly recorded: { root: string; path: string; message: string }[];
}

/** Revisions per vault root and path; `status` compares against the fake filesystem. */
export const createFakeRevisions = (roots: Map<string, FakeFs>): FakeRevisions => {
  const repos = new Map<string, Map<string, (Revision & { source: string })[]>>();
  const recorded: { root: string; path: string; message: string }[] = [];
  let n = 0;
  let rejection: string | null = null;
  const historyOf = (root: string, path: string) => repos.get(root)?.get(path) ?? [];
  const add = (root: string, path: string, source: string, summary: string, author: string) => {
    const repo = repos.get(root);
    if (!repo) throw new Error(`fake revisions: ${root} is not versioned`);
    n += 1;
    const revision = {
      id: `rev${String(n).padStart(4, '0')}${'0'.repeat(33)}`,
      timestamp: new Date(Date.UTC(2026, 9, 27, 12, n)).toISOString(),
      summary,
      author,
      path,
      source,
    };
    repo.set(path, [revision, ...historyOf(root, path)]);
    return revision;
  };
  const strip = ({ source: _source, ...revision }: Revision & { source: string }): Revision =>
    revision;
  return {
    recorded,
    enable: (root) => {
      if (!repos.has(root)) repos.set(root, new Map());
    },
    seed: (root, path, source, summary = `Edit ${path}`) =>
      strip(add(root, path, source, summary, 'Seed')),
    rejectNext: (output) => {
      rejection = output;
    },
    status: (root, path) => {
      if (!repos.has(root)) return Promise.resolve(ok({ kind: 'unversioned' }));
      const [last] = historyOf(root, path);
      if (!last) return Promise.resolve(ok({ kind: 'unrecorded' }));
      const current = roots.get(root)?.files.get(path);
      return Promise.resolve(
        ok({ kind: current === last.source ? 'clean' : 'modified', last: strip(last) }),
      );
    },
    list: (root, path) => Promise.resolve(ok(historyOf(root, path).map(strip))),
    read: (root, revision) => {
      const repo = repos.get(root);
      if (!repo) return Promise.resolve(err(unavailable(`${root} is not under version control`)));
      const found = [...repo.values()].flat().find((r) => r.id === revision.id);
      return Promise.resolve(
        found ? ok(found.source) : err(notFound(`No revision ${revision.id}`)),
      );
    },
    record: (root, path, message) => {
      if (!repos.has(root)) {
        return Promise.resolve(err(unavailable(`${root} is not under version control`)));
      }
      if (rejection !== null) {
        const output = rejection;
        rejection = null;
        return Promise.resolve(
          err(
            appError(
              'INTERNAL',
              `Revision of ${path} was not recorded (git commit exited 1):\n${output}`,
              {
                path,
                code: 1,
                output,
              },
            ),
          ),
        );
      }
      const source = roots.get(root)?.files.get(path);
      if (source === undefined) return Promise.resolve(err(notFound(`No file at ${path}`)));
      recorded.push({ root, path, message });
      return Promise.resolve(ok(strip(add(root, path, source, message, 'Tester'))));
    },
  };
};

export interface Fixture {
  deps: AppDeps;
  revisions: FakeRevisions;
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
  const revisions = createFakeRevisions(roots);
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
    revisions,
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
    revisions,
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
