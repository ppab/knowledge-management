import type { AppError } from '../domain/errors.js';
import type { UniqueSource } from '../domain/identity/identity.js';
import type { Heading } from '../domain/note/note.js';
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

export interface NoteDocument {
  readonly path: string;
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
  list(root: string, include: readonly string[], exclude: readonly string[]): Promise<string[]>;
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
}

export interface AppDeps {
  readonly clock: Clock;
  readonly unique: UniqueSource;
  readonly vaults: VaultRepository;
  readonly notes: NoteStore;
  readonly markdown: MarkdownParser;
  readonly frontmatter: FrontmatterCodec;
  readonly templates: TemplateRepository;
}
