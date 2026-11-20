/*
 * A vault-defined Astro theme: the contract of one Astro site, declared as data in
 * `.ofl/astro-themes/<name>/theme.yaml` rather than compiled in. It says where each content
 * collection lives, its URL shape, which fields a note must carry to be published into it, and
 * how a note's metadata maps onto the site's frontmatter. Data only — the application compiles it
 * into the same theme contract the built-in profile implements (ADR 0009).
 */

/** Where vault themes live, under the vault directory: `<VAULT_DIR>/astro-themes/<name>/theme.yaml`. */
export const ASTRO_THEMES_DIR = 'astro-themes';
export const ASTRO_THEME_FILE = 'theme.yaml';

/** Theme and collection names: lowercase letters, digits and hyphens. */
export const THEME_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Placeholders a collection's `path` may use; each is defined for every entry. */
export const PATH_VARIABLES = ['slug', 'id', 'stem'] as const;
/** Placeholders a collection's `route` may use (`type` fails the plan on a typeless entry). */
export const ROUTE_VARIABLES = ['slug', 'id', 'dir', 'stem', 'type'] as const;

/**
 * Core keys a theme field may name. They are not ordinary fields (the core interprets them), so
 * such a field can only say the key is `required` — e.g. an explicit `slug`, so a published URL
 * never follows a retitle.
 */
export const REQUIRABLE_CORE_KEYS = ['slug', 'type', 'tags'] as const;
export type RequirableCoreKey = (typeof REQUIRABLE_CORE_KEYS)[number];

export type ThemeFieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'list';

export interface ThemeField {
  readonly name: string;
  readonly type: ThemeFieldType;
  /** Allowed values when `type` is `enum`. */
  readonly values?: readonly string[];
  /** Element type when `type` is `list` (default `string`). */
  readonly of?: Exclude<ThemeFieldType, 'enum' | 'list'>;
  /** A note without this field cannot be published into the collection. */
  readonly required?: boolean;
  /** A regular expression a `string` value must match in full, e.g. a lowercase slug. */
  readonly pattern?: string;
  readonly description?: string;
}

/** One output frontmatter key: the first source that has a value wins. */
export interface FrontmatterSource {
  /**
   * Source names, in order of preference. `title`, `id`, `slug`, `type` and `tags` are the
   * entry's resolved core values; any other name is read from the note's frontmatter.
   */
  readonly from: readonly string[];
  /** `date` trims a date or instant to `YYYY-MM-DD`. */
  readonly as?: 'date';
}

export interface AstroCollectionSpec {
  /** The collection's URL shape, e.g. `/notebook/{{slug}}/`. */
  readonly route: string;
  /** File path under `contentDir`, e.g. `notebook/en/{{slug}}.md`; default `<collection>/{{slug}}.md`. */
  readonly path?: string;
  /** `forbid` refuses a note whose body contains an image (the publish does not copy assets). */
  readonly images: 'allow' | 'forbid';
  readonly fields: readonly ThemeField[];
  /** Output frontmatter key → where its value comes from. */
  readonly frontmatter: Readonly<Record<string, FrontmatterSource>>;
}

export interface AstroThemeSpec {
  readonly name: string;
  /** The ofl version the theme file was written for (`version:`). */
  readonly version: string;
  /** Where the site keeps content collections, relative to the publication's `output`. */
  readonly contentDir: string;
  readonly collections: Readonly<Record<string, AstroCollectionSpec>>;
}
