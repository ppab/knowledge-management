import type { AppError } from '../domain/errors.js';
import type { UniqueSource } from '../domain/identity/identity.js';
import type { Heading, NoteEntry } from '../domain/note/note.js';
import type { EntrySummary, NoteSummary } from '../domain/note/summary.js';
import type { Reference } from '../domain/reference/reference.js';
import type { Result } from '../domain/result.js';
import type { SourceRange } from '../domain/text/text-edit.js';
import type { VaultConfig } from '../domain/vault/vault.js';

/*
 * Ports: what the application needs from the outside world. Infrastructure implements them;
 * tests substitute in-memory fakes (test/fakes). Paths handed to ports are vault-relative POSIX
 * paths already normalized by the domain; `root` is the vault's absolute directory.
 */

export interface Clock {
  now(): Date;
}

export interface VaultRepository {
  /** Nearest directory at or above `cwd` that contains `.notes/config.yaml`, or `null`. */
  findNearest(cwd: string): Promise<string | null>;
  exists(root: string): Promise<boolean>;
  load(root: string): Promise<Result<VaultConfig, AppError>>;
  /** Creates `.notes/` (config, templates/, snippets/, cache/.gitignore) under `root`. */
  create(root: string, config: VaultConfig): Promise<Result<void, AppError>>;
}

/** A file's cheap fingerprint; a change in either means the content must be re-read. */
export interface NoteFile {
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
}

export interface NoteDocument extends NoteFile {
  readonly source: string;
  /** Content hash; compare with `WriteOptions.expectedVersion` to detect concurrent edits. */
  readonly version: string;
}

export interface WriteOptions {
  /** Refuse with `CONFLICT` if the file's current version differs. */
  readonly expectedVersion?: string;
  /** Refuse with `CONFLICT` if the file already exists. */
  readonly createOnly?: boolean;
}

export interface NoteStore {
  list(root: string, include: readonly string[], exclude: readonly string[]): Promise<NoteFile[]>;
  read(root: string, path: string): Promise<Result<NoteDocument, AppError>>;
  write(
    root: string,
    path: string,
    source: string,
    options?: WriteOptions,
  ): Promise<Result<{ version: string }, AppError>>;
}

export interface ParsedMarkdown {
  readonly headings: readonly Heading[];
  readonly references: readonly Reference[];
  /** Prose spans (mdast `text` nodes); the only places selections and references may live. */
  readonly textSpans: readonly SourceRange[];
}

export interface MarkdownParser {
  /** Parses `source` from `bodyStart` on; all ranges are absolute offsets into `source`. */
  parse(source: string, bodyStart: number): ParsedMarkdown;
}

export interface FrontmatterUpdate {
  /** Applied to every string scalar before the structural changes. */
  readonly mapStrings?: (value: string) => string;
  readonly remove?: readonly string[];
  readonly set?: Readonly<Record<string, unknown>>;
  readonly setIfMissing?: Readonly<Record<string, unknown>>;
}

export interface FrontmatterCodec {
  /** `{}` for empty text; `VALIDATION` if the YAML is invalid or not a mapping. */
  parse(yaml: string): Result<Record<string, unknown>, AppError>;
  /** Returns YAML text ending in a newline, preserving comments, order and unknown keys. */
  update(yaml: string, update: FrontmatterUpdate): Result<string, AppError>;
}

export interface TemplateSource {
  readonly name: string;
  readonly source: string;
}

export interface TemplateRepository {
  getTemplate(root: string, name: string): Promise<Result<TemplateSource, AppError>>;
  listTemplates(root: string): Promise<string[]>;
  /** `.notes/snippets/<name>.md`; there is no built-in snippet. */
  getSnippet(root: string, name: string): Promise<Result<TemplateSource, AppError>>;
}

/*
 * The note index is a disposable projection of the vault's files. It is keyed by path, not id,
 * because duplicate ids must be representable so `doctor` can report them.
 */

export interface IndexedFile extends NoteFile {
  readonly version: string;
}

export interface IndexedReference {
  readonly sourcePath: string;
  readonly target: string;
  readonly label?: string;
  readonly range: SourceRange;
}

export interface SearchHit {
  readonly entry: EntrySummary;
  /** Lower is better (bm25); comparable only within one index. */
  readonly score: number;
  readonly snippet: string;
}

export interface DateHit {
  readonly date: string;
  readonly entry: NoteSummary;
}

export interface IndexStats {
  readonly notes: number;
  readonly unidentified: number;
  readonly references: number;
  readonly schemaVersion: number;
}

export interface NoteIndex {
  files(): IndexedFile[];
  upsert(entry: NoteEntry, file: NoteFile): void;
  /** Records a new fingerprint for an unchanged file (e.g. after `touch`). */
  touch(file: NoteFile): void;
  remove(path: string): void;
  clear(): void;
  /** Runs `work` in one transaction. */
  batch<T>(work: () => T): T;

  all(): EntrySummary[];
  byPath(path: string): EntrySummary | null;
  byId(id: string): NoteSummary[];
  /** Case-insensitive match on title or alias; identified notes only. */
  byName(name: string): NoteSummary[];
  byField(key: string, value?: string): EntrySummary[];
  onDate(date: string): NoteSummary[];
  /** Inclusive range, ordered by date then path. */
  datesBetween(from: string, to: string): DateHit[];
  search(query: string, limit: number): SearchHit[];
  outgoing(sourcePath: string): IndexedReference[];
  backlinks(targetId: string): IndexedReference[];
  /** References whose target matches no indexed id. */
  dangling(): IndexedReference[];
  stats(): IndexStats;
  close(): void;
}

export interface NoteIndexProvider {
  /** Opens (creating or resetting on schema mismatch) the index under `root/.notes/cache/`. */
  open(root: string): Promise<Result<NoteIndex, AppError>>;
}

/** Named scopes from the user's own configuration (not any vault's). Roots are absolute. */
export interface ScopeDefinition {
  readonly vaults: readonly string[];
}

export interface UserConfig {
  readonly scopes: Readonly<Record<string, ScopeDefinition>>;
}

export interface UserConfigRepository {
  /** Where the configuration is read from, for messages. */
  path(): string;
  /** A missing file is an empty configuration, not an error. */
  load(): Promise<Result<UserConfig, AppError>>;
}

export interface AppDeps {
  readonly clock: Clock;
  readonly unique: UniqueSource;
  readonly vaults: VaultRepository;
  readonly notes: NoteStore;
  readonly markdown: MarkdownParser;
  readonly frontmatter: FrontmatterCodec;
  readonly templates: TemplateRepository;
  readonly indexes: NoteIndexProvider;
  readonly userConfig: UserConfigRepository;
}
