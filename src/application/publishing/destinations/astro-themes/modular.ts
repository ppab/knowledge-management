import type { PlanEntry } from '../../../../domain/publishing/plan.js';
import type { FieldSpec } from '../../../plugin/plugin.js';
import type { AstroTheme } from '../astro.js';

/*
 * The `modular` Astro theme profile (github.com/davidvkimball/astro-modular, MIT, v1.1.11). It
 * mirrors the posts collection of the theme's `src/content.config.ts`: the fields a post may
 * carry, the collection's URL shape, and the mapping from an entry's core metadata onto the
 * theme's frontmatter. A new theme is a new profile file, not a new destination kind.
 */

const POST_FIELDS: readonly FieldSpec[] = [
  // Required: the theme silently defaults a missing description to "No description provided",
  // which is the SEO hole doctor should surface before publish.
  { name: 'description', type: 'string', required: true, description: 'meta description' },
  { name: 'image', type: 'string', description: 'cover image path' },
  { name: 'imageAlt', type: 'string', description: 'cover image alt text' },
  { name: 'imageOG', type: 'string', description: 'social-share image path' },
  { name: 'hideCoverImage', type: 'boolean' },
  { name: 'hideTOC', type: 'boolean' },
  { name: 'showTOC', type: 'boolean' },
  { name: 'noIndex', type: 'boolean', description: 'ask search engines not to index' },
  { name: 'draft', type: 'boolean' },
  { name: 'targetKeyword', type: 'string', description: 'primary SEO keyword' },
  { name: 'author', type: 'string' },
];

/** A created instant or date → `YYYY-MM-DD`; anything else → undefined. */
const toDate = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  return undefined;
};

export const modularTheme: AstroTheme = {
  name: 'modular',
  contentDir: 'src/content',
  collections: { posts: { route: '/posts/{{slug}}/' } },
  fields: POST_FIELDS,
  frontmatter: (entry: PlanEntry, source) => {
    const out: Record<string, unknown> = { title: entry.title };
    // `date` drives the post's URL date and feeds the RSS/sitemap; the theme falls back to build
    // time when absent, so emit it whenever the source has a created instant or a bound date.
    const date = toDate(source.created) ?? entry.dates[0];
    if (date !== undefined) out.date = date;
    if (entry.tags.length > 0) out.tags = [...entry.tags];
    for (const field of POST_FIELDS) {
      if (source[field.name] !== undefined) out[field.name] = source[field.name];
    }
    // Kept for traceability back to the vault; the theme's zod strips unknown keys harmlessly.
    out.id = entry.id;
    return out;
  },
};
