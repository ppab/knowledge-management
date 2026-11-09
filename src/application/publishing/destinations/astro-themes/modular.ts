import type { PlanEntry } from '../../../../domain/publishing/plan.js';
import type { FieldSpec } from '../../../plugin/plugin.js';
import type { AstroCollection, AstroTheme } from '../astro.js';

/*
 * The `modular` Astro theme profile (github.com/davidvkimball/astro-modular, MIT, v1.1.11). Each
 * collection mirrors one schema of the theme's `src/content.config.ts` — the fields a record may
 * carry, its URL shape (from `src/pages/`), and the mapping from an entry's core metadata onto the
 * theme's frontmatter. It exposes every user-facing collection the theme defines: `posts`, `pages`,
 * `projects`, `docs`. The fifth, `special` (fixed-URL home blurb / 404 / section indexes), is
 * theme-internal and not a publish target. A different theme is a new profile file, not a new kind.
 */

/** A created instant or date → `YYYY-MM-DD`; anything else → undefined. */
const toDate = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  return undefined;
};

/** Copies each declared field present in the source onto the output (unknown keys stay out). */
const passThrough = (
  fields: readonly FieldSpec[],
  source: Readonly<Record<string, unknown>>,
  out: Record<string, unknown>,
): void => {
  for (const field of fields) {
    if (source[field.name] !== undefined) out[field.name] = source[field.name];
  }
};

// Required `description`: the theme silently defaults a missing one to "No description provided",
// which is the SEO hole doctor should surface before publish.
const DESCRIPTION: FieldSpec = {
  name: 'description',
  type: 'string',
  required: true,
  description: 'meta description',
};
const IMAGE_FIELDS: readonly FieldSpec[] = [
  { name: 'image', type: 'string', description: 'cover image path' },
  { name: 'imageAlt', type: 'string', description: 'cover image alt text' },
  { name: 'hideCoverImage', type: 'boolean' },
];
const TOC_FIELDS: readonly FieldSpec[] = [
  { name: 'hideTOC', type: 'boolean' },
  { name: 'showTOC', type: 'boolean' },
];
const NO_INDEX: FieldSpec = {
  name: 'noIndex',
  type: 'boolean',
  description: 'ask search engines not to index',
};

const POST_FIELDS: readonly FieldSpec[] = [
  DESCRIPTION,
  ...IMAGE_FIELDS,
  { name: 'imageOG', type: 'boolean', description: 'generate a social-share image' },
  ...TOC_FIELDS,
  NO_INDEX,
  { name: 'draft', type: 'boolean' },
  { name: 'targetKeyword', type: 'string', description: 'primary SEO keyword' },
  { name: 'author', type: 'string' },
];

const posts: AstroCollection = {
  route: '/posts/{{slug}}/',
  fields: POST_FIELDS,
  frontmatter: (entry: PlanEntry, source) => {
    const out: Record<string, unknown> = { title: entry.title };
    // `date` drives the post's URL date and feeds the RSS/sitemap; the theme falls back to build
    // time when absent, so emit it whenever the source has a created instant or a bound date.
    const date = toDate(source.created) ?? entry.dates[0];
    if (date !== undefined) out.date = date;
    if (entry.tags.length > 0) out.tags = [...entry.tags];
    passThrough(POST_FIELDS, source, out);
    out.id = entry.id; // Traceability; the theme's zod strips unknown keys harmlessly.
    return out;
  },
};

const PAGE_FIELDS: readonly FieldSpec[] = [
  DESCRIPTION,
  ...IMAGE_FIELDS,
  ...TOC_FIELDS,
  NO_INDEX,
  { name: 'draft', type: 'boolean' },
];

const pages: AstroCollection = {
  route: '/{{slug}}/',
  fields: PAGE_FIELDS,
  frontmatter: (entry: PlanEntry, source) => {
    const out: Record<string, unknown> = { title: entry.title };
    const modified = toDate(source.created) ?? entry.dates[0];
    if (modified !== undefined) out.lastModified = modified;
    passThrough(PAGE_FIELDS, source, out);
    out.id = entry.id;
    return out;
  },
};

const PROJECT_FIELDS: readonly FieldSpec[] = [
  DESCRIPTION,
  { name: 'categories', type: 'list', of: 'string' },
  { name: 'repositoryUrl', type: 'string' },
  { name: 'projectUrl', type: 'string' },
  { name: 'demoUrl', type: 'string' },
  { name: 'status', type: 'string' },
  ...IMAGE_FIELDS,
  ...TOC_FIELDS,
  { name: 'featured', type: 'boolean' },
  { name: 'draft', type: 'boolean' },
  NO_INDEX,
];

const projects: AstroCollection = {
  route: '/projects/{{slug}}/',
  fields: PROJECT_FIELDS,
  frontmatter: (entry: PlanEntry, source) => {
    const out: Record<string, unknown> = { title: entry.title };
    const date = toDate(source.created) ?? entry.dates[0];
    if (date !== undefined) out.date = date;
    passThrough(PROJECT_FIELDS, source, out);
    out.id = entry.id;
    return out;
  },
};

const DOC_FIELDS: readonly FieldSpec[] = [
  DESCRIPTION,
  { name: 'category', type: 'string' },
  { name: 'order', type: 'number' },
  { name: 'version', type: 'string' },
  ...IMAGE_FIELDS,
  ...TOC_FIELDS,
  { name: 'featured', type: 'boolean' },
  { name: 'draft', type: 'boolean' },
  NO_INDEX,
];

const docs: AstroCollection = {
  route: '/docs/{{slug}}/',
  fields: DOC_FIELDS,
  frontmatter: (entry: PlanEntry, source) => {
    const out: Record<string, unknown> = { title: entry.title };
    const modified = toDate(source.created) ?? entry.dates[0];
    if (modified !== undefined) out.lastModified = modified;
    passThrough(DOC_FIELDS, source, out);
    out.id = entry.id;
    return out;
  },
};

export const modularTheme: AstroTheme = {
  name: 'modular',
  contentDir: 'src/content',
  collections: { posts, pages, projects, docs },
};
