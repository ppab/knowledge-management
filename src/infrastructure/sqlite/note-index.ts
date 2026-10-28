import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { unavailable } from '../../domain/errors.js';
import { flattenFields, type FieldValue } from '../../domain/note/fields.js';
import type { NoteEntry } from '../../domain/note/note.js';
import { asNoteId } from '../../domain/note/note-id.js';
import { summarize, type EntrySummary, type NoteSummary } from '../../domain/note/summary.js';
import type { Visibility } from '../../domain/note/note.js';
import { err, ok } from '../../domain/result.js';
import { VAULT_DIR } from '../../domain/vault/vault.js';
import type {
  DateHit,
  IndexedFile,
  IndexedReference,
  NoteFile,
  NoteIndex,
  NoteIndexProvider,
  SearchHit,
} from '../../application/ports.js';
import { openSqlite, type SqliteDriver, type SqliteStatement } from './driver.js';

export const SCHEMA_VERSION = 2;
export const INDEX_FILE = 'index.sqlite';

/*
 * Schema (docs/architecture.md §4). `notes` is keyed by path; `id` is merely indexed so
 * duplicates stay visible. Aliases, dates and tags are kept both as JSON on the row (to
 * rehydrate a summary in one read) and as lookup tables (to query by them). `fields` holds every
 * frontmatter key the core does not interpret, flattened for plugin queries.
 */
const TABLES = ['meta', 'notes', 'aliases', 'dates', 'tags', 'fields', 'refs', 'notes_fts'];

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE notes (
  rowid INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  physical_key TEXT,
  id TEXT,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  visibility TEXT NOT NULL,
  type TEXT,
  slug TEXT,
  version TEXT NOT NULL,
  mtime REAL NOT NULL,
  size INTEGER NOT NULL,
  unidentified INTEGER NOT NULL,
  aliases TEXT NOT NULL,
  dates TEXT NOT NULL,
  tags TEXT NOT NULL,
  fields TEXT NOT NULL,
  issues TEXT NOT NULL
);
CREATE INDEX notes_id ON notes (id);
CREATE INDEX notes_title_key ON notes (title_key);
CREATE TABLE aliases (path TEXT NOT NULL, alias TEXT NOT NULL, alias_key TEXT NOT NULL);
CREATE INDEX aliases_key ON aliases (alias_key);
CREATE INDEX aliases_path ON aliases (path);
CREATE TABLE dates (path TEXT NOT NULL, date TEXT NOT NULL);
CREATE INDEX dates_date ON dates (date);
CREATE INDEX dates_path ON dates (path);
CREATE TABLE tags (path TEXT NOT NULL, tag TEXT NOT NULL);
CREATE INDEX tags_tag ON tags (tag);
CREATE INDEX tags_path ON tags (path);
CREATE TABLE fields (path TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, kind TEXT NOT NULL);
CREATE INDEX fields_key_value ON fields (key, value);
CREATE INDEX fields_path ON fields (path);
CREATE TABLE refs (path TEXT NOT NULL, target TEXT NOT NULL, label TEXT, start INTEGER NOT NULL, end INTEGER NOT NULL);
CREATE INDEX refs_target ON refs (target);
CREATE INDEX refs_path ON refs (path);
CREATE VIRTUAL TABLE notes_fts USING fts5(
  path UNINDEXED, title, aliases, body, tokenize = 'unicode61 remove_diacritics 2'
);
`;

interface NoteRow {
  path: string;
  id: string | null;
  title: string;
  visibility: string;
  type: string | null;
  slug: string | null;
  version: string;
  mtime: number;
  size: number;
  unidentified: number;
  aliases: string;
  dates: string;
  tags: string;
  fields: string;
  issues: string;
}

interface RefRow {
  path: string;
  target: string;
  label: string | null;
  start: number;
  end: number;
}

const NOTE_COLUMNS =
  'path, id, title, visibility, type, slug, version, mtime, size, unidentified, aliases, dates, tags, fields, issues';

const toSummary = (row: NoteRow): EntrySummary => {
  const base = {
    path: row.path,
    title: row.title,
    aliases: JSON.parse(row.aliases) as string[],
    dates: JSON.parse(row.dates) as string[],
    tags: JSON.parse(row.tags) as string[],
    visibility: row.visibility as Visibility,
    ...(row.type !== null && { type: row.type }),
    ...(row.slug !== null && { slug: row.slug }),
    fields: JSON.parse(row.fields) as Record<string, FieldValue>,
    version: row.version,
    issues: JSON.parse(row.issues) as string[],
  };
  return row.unidentified === 1 || row.id === null
    ? { kind: 'unidentified', ...base }
    : { kind: 'note', id: asNoteId(row.id), ...base };
};

const toNote = (row: NoteRow): NoteSummary => toSummary(row) as NoteSummary;

const toReference = (row: RefRow): IndexedReference => ({
  sourcePath: row.path,
  target: row.target,
  ...(row.label !== null && { label: row.label }),
  range: { start: row.start, end: row.end },
});

/**
 * Builds an FTS5 MATCH expression that treats the user's text as words, never as syntax:
 * every term is quoted, terms are ANDed, and a trailing `*` requests prefix matching.
 */
export const toMatchExpression = (query: string): string | null => {
  const terms: string[] = [];
  for (const raw of query.match(/\S+/g) ?? []) {
    const prefix = raw.endsWith('*');
    const word = (prefix ? raw.slice(0, -1) : raw).replace(/"/g, '""');
    if (word !== '') terms.push(`"${word}"${prefix ? '*' : ''}`);
  }
  return terms.length > 0 ? terms.join(' ') : null;
};

export interface SqliteIndexOptions {
  readonly schemaVersion?: number;
  /** When false, `close()` leaves the driver open (shared in-memory databases in tests). */
  readonly closeDriver?: boolean;
}

export const createSqliteNoteIndex = (
  driver: SqliteDriver,
  options: SqliteIndexOptions = {},
): NoteIndex => {
  const schemaVersion = options.schemaVersion ?? SCHEMA_VERSION;
  const statements = new Map<string, SqliteStatement>();
  const sql = (text: string): SqliteStatement => {
    let statement = statements.get(text);
    if (!statement) {
      statement = driver.prepare(text);
      statements.set(text, statement);
    }
    return statement;
  };

  const createSchema = (): void => {
    driver.exec(TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n'));
    driver.exec(SCHEMA);
    sql('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(schemaVersion));
  };
  const ensureSchema = (): void => {
    const hasMeta = sql(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
    ).get<{ found: number }>();
    const current = hasMeta
      ? sql('SELECT value FROM meta WHERE key = ?').get<{ value: string }>('schema_version')
      : undefined;
    if (current === undefined || Number(current.value) !== schemaVersion) createSchema();
  };

  driver.exec('PRAGMA synchronous = NORMAL;');
  ensureSchema();

  const notesWhere = (where: string, ...params: (string | number)[]): EntrySummary[] =>
    sql(`SELECT ${NOTE_COLUMNS} FROM notes WHERE ${where} ORDER BY path`)
      .all<NoteRow>(...params)
      .map(toSummary);

  const remove = (path: string): void => {
    const row = sql('SELECT rowid FROM notes WHERE path = ?').get<{ rowid: number }>(path);
    if (!row) return;
    sql('DELETE FROM notes_fts WHERE rowid = ?').run(row.rowid);
    for (const table of ['aliases', 'dates', 'tags', 'fields', 'refs']) {
      sql(`DELETE FROM ${table} WHERE path = ?`).run(path);
    }
    sql('DELETE FROM notes WHERE path = ?').run(path);
  };

  const upsert = (entry: NoteEntry, file: NoteFile): void => {
    remove(entry.path);
    const summary = summarize(entry);
    const { lastInsertRowid } = sql(
      `INSERT INTO notes (${NOTE_COLUMNS}, title_key, physical_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.path,
      summary.kind === 'note' ? summary.id : null,
      summary.title,
      summary.visibility,
      summary.type ?? null,
      summary.slug ?? null,
      entry.version,
      file.mtime,
      file.size,
      summary.kind === 'unidentified' ? 1 : 0,
      JSON.stringify(summary.aliases),
      JSON.stringify(summary.dates),
      JSON.stringify(summary.tags),
      JSON.stringify(summary.fields),
      JSON.stringify(summary.issues),
      summary.title.toLowerCase(),
      file.physicalKey ?? null,
    );
    for (const alias of summary.aliases) {
      sql('INSERT INTO aliases (path, alias, alias_key) VALUES (?, ?, ?)').run(
        entry.path,
        alias,
        alias.toLowerCase(),
      );
    }
    for (const date of summary.dates) {
      sql('INSERT INTO dates (path, date) VALUES (?, ?)').run(entry.path, date);
    }
    for (const tag of summary.tags) {
      sql('INSERT INTO tags (path, tag) VALUES (?, ?)').run(entry.path, tag);
    }
    for (const field of flattenFields(summary.fields)) {
      sql('INSERT INTO fields (path, key, value, kind) VALUES (?, ?, ?, ?)').run(
        entry.path,
        field.key,
        field.value,
        field.kind,
      );
    }
    for (const ref of entry.references) {
      sql('INSERT INTO refs (path, target, label, start, end) VALUES (?, ?, ?, ?, ?)').run(
        entry.path,
        ref.target,
        ref.label ?? null,
        ref.range.start,
        ref.range.end,
      );
    }
    sql('INSERT INTO notes_fts (rowid, path, title, aliases, body) VALUES (?, ?, ?, ?, ?)').run(
      lastInsertRowid,
      entry.path,
      summary.title,
      summary.aliases.join(' '),
      entry.source.slice(entry.body.start),
    );
  };

  let closed = false;
  return {
    files: () =>
      sql('SELECT path, version, mtime, size, physical_key FROM notes')
        .all<IndexedFile & { physical_key: string | null }>()
        .map(({ physical_key, ...file }) => ({
          ...file,
          ...(physical_key !== null && { physicalKey: physical_key }),
        })),
    upsert,
    touch: (file) => {
      sql('UPDATE notes SET mtime = ?, size = ? WHERE path = ?').run(
        file.mtime,
        file.size,
        file.path,
      );
    },
    remove,
    clear: createSchema,
    batch: (work) => {
      driver.exec('BEGIN');
      try {
        const result = work();
        driver.exec('COMMIT');
        return result;
      } catch (cause) {
        driver.exec('ROLLBACK');
        throw cause;
      }
    },

    all: () => notesWhere('1 = 1'),
    byPath: (path) => notesWhere('path = ?', path)[0] ?? null,
    byId: (id) => notesWhere('id = ? AND unidentified = 0', id).map((e) => e as NoteSummary),
    byName: (name) => {
      const key = name.toLowerCase();
      return notesWhere(
        'unidentified = 0 AND (title_key = ? OR path IN (SELECT path FROM aliases WHERE alias_key = ?))',
        key,
        key,
      ).map((e) => e as NoteSummary);
    },
    byField: (key, value) =>
      value === undefined
        ? notesWhere('path IN (SELECT path FROM fields WHERE key = ?)', key)
        : notesWhere('path IN (SELECT path FROM fields WHERE key = ? AND value = ?)', key, value),
    onDate: (date) =>
      notesWhere('unidentified = 0 AND path IN (SELECT path FROM dates WHERE date = ?)', date).map(
        (e) => e as NoteSummary,
      ),
    datesBetween: (from, to) =>
      sql(
        `SELECT d.date AS date, ${NOTE_COLUMNS.split(', ')
          .map((c) => `n.${c}`)
          .join(', ')}
         FROM dates d JOIN notes n ON n.path = d.path
         WHERE d.date BETWEEN ? AND ? AND n.unidentified = 0
         ORDER BY d.date, n.path`,
      )
        .all<NoteRow & { date: string }>(from, to)
        .map((row): DateHit => ({ date: row.date, entry: toNote(row) })),
    search: (query, limit) => {
      const match = toMatchExpression(query);
      if (match === null) return [];
      return sql(
        `SELECT ${NOTE_COLUMNS.split(', ')
          .map((c) => `n.${c}`)
          .join(', ')},
                bm25(notes_fts, 0, 10.0, 5.0, 1.0) AS score,
                snippet(notes_fts, -1, '[', ']', '…', 12) AS snippet
         FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY score, n.path
         LIMIT ?`,
      )
        .all<NoteRow & { score: number; snippet: string }>(match, limit)
        .map((row): SearchHit => ({
          entry: toSummary(row),
          score: row.score,
          snippet: row.snippet,
        }));
    },
    outgoing: (sourcePath) =>
      sql('SELECT path, target, label, start, end FROM refs WHERE path = ? ORDER BY start')
        .all<RefRow>(sourcePath)
        .map(toReference),
    backlinks: (targetId) =>
      sql('SELECT path, target, label, start, end FROM refs WHERE target = ? ORDER BY path, start')
        .all<RefRow>(targetId)
        .map(toReference),
    dangling: () =>
      sql(
        `SELECT r.path, r.target, r.label, r.start, r.end FROM refs r
         WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = r.target AND n.unidentified = 0)
         ORDER BY r.path, r.start`,
      )
        .all<RefRow>()
        .map(toReference),
    stats: () => {
      const count = (text: string): number => sql(text).get<{ n: number }>()?.n ?? 0;
      return {
        notes: count('SELECT COUNT(*) AS n FROM notes'),
        unidentified: count('SELECT COUNT(*) AS n FROM notes WHERE unidentified = 1'),
        references: count('SELECT COUNT(*) AS n FROM refs'),
        schemaVersion,
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      if (options.closeDriver ?? true) driver.close();
    },
  };
};

export const createSqliteIndexProvider = (): NoteIndexProvider => ({
  async open(root) {
    const dir = join(root, VAULT_DIR, 'cache');
    try {
      await mkdir(dir, { recursive: true });
      return ok(createSqliteNoteIndex(openSqlite(join(dir, INDEX_FILE))));
    } catch (cause) {
      return err(
        unavailable(`Cannot open the index at ${join(dir, INDEX_FILE)}`, { cause: String(cause) }),
      );
    }
  },
});
