import { validation, type AppError } from '../../../domain/errors.js';
import { wrapFrontmatter } from '../../../domain/note/frontmatter.js';
import type { PlanEntry } from '../../../domain/publishing/plan.js';
import { routeVariables } from '../../../domain/publishing/route.js';
import { err, ok, type Result } from '../../../domain/result.js';
import type { FieldSpec } from '../../plugin/plugin.js';
import type { Destination } from '../destination.js';
import { modularTheme } from './astro-themes/modular.js';

/*
 * The astro destination writes Markdown into an Astro content collection. Astro is chosen for the
 * MVP because the target theme is SEO-ready (sitemap, RSS, OG images, noIndex, meta description).
 *
 * `astro` is the kind; a `theme` option picks a profile that owns the real contract — the content
 * directory, the collection's URL shape, and the frontmatter schema. The destination is theme-
 * agnostic; the theme is data plus one mapping function.
 */

export interface AstroTheme {
  readonly name: string;
  readonly contentDir: string;
  readonly collections: Readonly<Record<string, { readonly route: string }>>;
  /** The theme's frontmatter schema, minus the keys the core maps itself. */
  readonly fields: readonly FieldSpec[];
  frontmatter(entry: PlanEntry, source: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

const THEMES: Readonly<Record<string, AstroTheme>> = { modular: modularTheme };

interface AstroOptions {
  readonly theme: AstroTheme;
  readonly collection: string;
}

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

const parse = (raw: unknown): Result<AstroOptions, AppError> => {
  const source = raw ?? {};
  if (!isObject(source)) return err(validation('destination options must be a mapping'));
  const { theme: themeName = 'modular', collection = 'posts', ...rest } = source;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) {
    return err(validation(`unknown destination option(s): ${unknown.join(', ')}`, { unknown }));
  }
  const theme = typeof themeName === 'string' ? THEMES[themeName] : undefined;
  if (theme === undefined) {
    return err(
      validation(`unknown astro theme ${JSON.stringify(themeName)}`, {
        known: Object.keys(THEMES),
      }),
    );
  }
  if (typeof collection !== 'string' || !(collection in theme.collections)) {
    return err(
      validation(`theme ${theme.name} has no collection ${JSON.stringify(collection)}`, {
        known: Object.keys(theme.collections),
      }),
    );
  }
  return ok({ theme, collection });
};

const options = (raw: unknown): AstroOptions => raw as AstroOptions;

export const astroDestination: Destination = {
  kind: 'astro',
  description: 'Markdown in an Astro content collection (SEO-ready via a theme profile)',
  settings: parse,
  fields: (raw) => options(raw).theme.fields,
  fixedRoute: (raw) => {
    const { theme, collection } = options(raw);
    return theme.collections[collection]?.route;
  },
  // Hidden, and outside the theme's `src/content` Obsidian vault, so it is not itself a post.
  manifestPath: () => '.capture/manifest.json',
  pathFor: (entry, raw) => {
    const { theme, collection } = options(raw);
    const slug = routeVariables(entry).slug;
    return `${theme.contentDir}/${collection}/${slug}.md`;
  },
  linkTo: (_from, to) => to.entry.route,
  render: (input, tools, raw) => {
    const { theme } = options(raw);
    const frontmatter = theme.frontmatter(input.entry, input.frontmatter);
    const yaml = tools.updateFrontmatter('', { set: frontmatter });
    if (!yaml.ok) return yaml;
    return ok(wrapFrontmatter(yaml.value) + input.body);
  },
};
