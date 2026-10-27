import type { SourceRange } from '../text/text-edit.js';
import type { Visibility } from './note.js';

/**
 * Locates a YAML frontmatter block without parsing the YAML (that needs a library and lives
 * behind the `FrontmatterCodec` port). `yamlRange` covers the text between the fences,
 * including the trailing newline before the closing fence, so replacing it with codec output
 * (which ends in a newline) keeps the fences intact.
 */
export interface FrontmatterBlock {
  readonly yaml: string;
  readonly yamlRange: SourceRange;
  /** The whole block, from the opening fence to the end of the closing fence line. */
  readonly blockRange: SourceRange;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;

export const splitFrontmatter = (source: string): FrontmatterBlock | null => {
  const open = OPEN.exec(source);
  if (!open) return null;
  CLOSE.lastIndex = open[0].length;
  const close = CLOSE.exec(source);
  if (!close) return null;
  const yamlRange = { start: open[0].length, end: close.index };
  return {
    yaml: source.slice(yamlRange.start, yamlRange.end),
    yamlRange,
    blockRange: { start: 0, end: close.index + close[0].length },
  };
};

/** Wraps codec output in fences for a document that had no frontmatter. */
export const wrapFrontmatter = (yaml: string): string =>
  `---\n${yaml.endsWith('\n') || yaml === '' ? yaml : yaml + '\n'}---\n`;

/** Frontmatter keys the system interprets. Everything else is preserved opaquely. */
export const KNOWN_KEYS = [
  'id',
  'title',
  'created',
  'aliases',
  'dates',
  'tags',
  'visibility',
  'type',
  'slug',
] as const;

export interface FrontmatterFields {
  readonly id?: string;
  readonly title?: string;
  /** Creation timestamp (ISO 8601) written by `create`; independent of `dates` bindings. */
  readonly created?: string;
  readonly aliases: readonly string[];
  readonly dates: readonly string[];
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  readonly type?: string;
  readonly slug?: string;
  /** Human-readable problems with recognized keys; never fatal, surfaced by `doctor`. */
  readonly issues: readonly string[];
}

const asString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return undefined;
};

const asStringList = (value: unknown, key: string, issues: string[]): string[] => {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    const s = asString(item);
    if (s === undefined) issues.push(`"${key}" contains a non-string entry`);
    else out.push(s);
  }
  return out;
};

/** Reads the recognized keys from parsed frontmatter data with lenient coercion. */
export const readFrontmatterFields = (
  data: Readonly<Record<string, unknown>>,
): FrontmatterFields => {
  const issues: string[] = [];
  const scalar = (key: string): string | undefined => {
    if (data[key] === undefined || data[key] === null) return undefined;
    const s = asString(data[key]);
    if (s === undefined) issues.push(`"${key}" must be a string`);
    return s;
  };

  const visibilityRaw = scalar('visibility');
  let visibility: Visibility = 'private';
  if (visibilityRaw === 'public' || visibilityRaw === 'private') visibility = visibilityRaw;
  else if (visibilityRaw !== undefined) issues.push(`"visibility" must be "public" or "private"`);

  const id = scalar('id');
  const title = scalar('title');
  const type = scalar('type');
  const slug = scalar('slug');
  // A YAML parser with a timestamp schema hands over a Date; keep the full instant.
  const created = data.created instanceof Date ? data.created.toISOString() : scalar('created');
  return {
    ...(id !== undefined && { id }),
    ...(title !== undefined && { title }),
    ...(created !== undefined && { created }),
    aliases: asStringList(data.aliases, 'aliases', issues),
    dates: [...new Set(asStringList(data.dates, 'dates', issues))],
    tags: asStringList(data.tags, 'tags', issues),
    visibility,
    ...(type !== undefined && { type }),
    ...(slug !== undefined && { slug }),
    issues,
  };
};
