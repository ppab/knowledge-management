import type { Reference } from '../reference/reference.js';
import type { SourceRange } from '../text/text-edit.js';
import type { EntryId } from './entry-id.js';

export type Visibility = 'public' | 'private';

export interface Heading {
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  /** The heading line itself. */
  readonly range: SourceRange;
}

/** What is common to every Markdown file a vault manages, identified or not. */
interface EntryBase {
  /** Vault-relative POSIX path of the storage file. */
  readonly path: string;
  readonly title: string;
  readonly source: string;
  /** Content hash of `source`, used for conflict detection. */
  readonly version: string;
  /** Parsed frontmatter, including keys the system does not interpret. */
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: SourceRange;
  readonly headings: readonly Heading[];
  readonly references: readonly Reference[];
  readonly issues: readonly string[];
}

/** A persistent knowledge entity. Its identity is independent of `path`. */
export interface Entry extends EntryBase {
  readonly kind: 'entry';
  readonly id: EntryId;
  readonly aliases: readonly string[];
  readonly dates: readonly string[];
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  readonly type?: string;
  readonly slug?: string;
  /** ISO 8601 instant written by `create`; a timestamp, not a date binding. */
  readonly created?: string;
}

/**
 * A file matched by the vault's `include` globs that has no `id` yet. Listed and searchable,
 * but it cannot be mutated or referenced until `adopt` assigns an identity.
 */
export interface UnidentifiedEntry extends EntryBase {
  readonly kind: 'unidentified';
}

export type AnyEntry = Entry | UnidentifiedEntry;

export const isEntry = (entry: AnyEntry): entry is Entry => entry.kind === 'entry';

/** Title fallback order: frontmatter `title` → first level-1 heading → filename stem. */
export const resolveTitle = (
  frontmatterTitle: string | undefined,
  headings: readonly Heading[],
  path: string,
): string => {
  if (frontmatterTitle !== undefined && frontmatterTitle.trim() !== '') return frontmatterTitle;
  const h1 = headings.find((h) => h.depth === 1);
  if (h1 && h1.text.trim() !== '') return h1.text;
  const stem = path.split('/').pop() ?? path;
  return stem.replace(/\.[^.]+$/, '');
};

export const slugify = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
