import { validation } from '../../../domain/errors.js';
import { wrapFrontmatter } from '../../../domain/entry/frontmatter.js';
import type { PlanEntry } from '../../../domain/publishing/plan.js';
import { routeVariables } from '../../../domain/publishing/route.js';
import { err, ok } from '../../../domain/result.js';
import type { FieldSpec } from '../../plugin/plugin.js';
import type { Destination } from '../destination.js';

/*
 * The astro destination writes Markdown into an Astro content collection. Astro is chosen for the
 * MVP because the target theme is SEO-ready (sitemap, RSS, OG images, noIndex, meta description).
 *
 * `astro` is the kind; a `theme` option picks a profile that owns the real contract. The theme is
 * the public extension point (`AstroTheme`): data plus, per collection, a URL shape, the source
 * fields doctor checks, and the mapping from an entry's core metadata onto the theme's frontmatter.
 * The destination itself is theme-agnostic. It is built by a factory over a set of themes, so the
 * registry can aggregate the built-in `modular` profile with themes any enabled plugin contributes.
 */

/** One publish target the theme defines: a content collection with its own URL and schema. */
export interface AstroCollection {
  /** The collection's URL shape, e.g. `/posts/{{slug}}/`. */
  readonly route: string;
  /** The collection's frontmatter schema, minus the keys the core maps itself. */
  readonly fields: readonly FieldSpec[];
  /** Maps an entry's core metadata and source frontmatter onto this collection's frontmatter. */
  frontmatter(entry: PlanEntry, source: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

export interface AstroTheme {
  readonly name: string;
  /** Where the theme keeps content collections, e.g. `src/content`. */
  readonly contentDir: string;
  readonly collections: Readonly<Record<string, AstroCollection>>;
}

interface AstroOptions {
  readonly theme: string;
  readonly collection: string;
}
const opts = (raw: unknown): AstroOptions => raw as AstroOptions;

/**
 * Builds the astro destination over a set of themes. The `theme` option is an enum of their names;
 * the `collection` option is an enum of the chosen theme's collections. The built-in export closes
 * over `[modularTheme]`; the registry closes over `modular` plus plugin-contributed themes.
 */
export const createAstroDestination = (themes: readonly AstroTheme[]): Destination => {
  const byName = new Map(themes.map((theme) => [theme.name, theme]));
  const themeNames = themes.map((theme) => theme.name);
  const defaultTheme = byName.has('modular') ? 'modular' : (themeNames[0] ?? 'modular');

  const themeOf = (raw: unknown): AstroTheme | undefined => byName.get(opts(raw).theme);
  const collectionOf = (raw: unknown): AstroCollection | undefined =>
    themeOf(raw)?.collections[opts(raw).collection];

  return {
    kind: 'astro',
    description: 'Markdown in an Astro content collection (SEO-ready via a theme profile)',
    options: (chosen) => {
      const chosenTheme = typeof chosen?.theme === 'string' ? chosen.theme : defaultTheme;
      const collections = byName.get(chosenTheme)?.collections;
      const names = collections ? Object.keys(collections) : ['posts'];
      return [
        {
          name: 'theme',
          type: 'enum',
          values: themeNames,
          default: defaultTheme,
          description: 'Astro theme profile owning the collections and their schemas',
        },
        {
          name: 'collection',
          type: 'enum',
          values: names,
          default: names.includes('posts') ? 'posts' : (names[0] ?? 'posts'),
          description: "content collection to write into (the theme's record kind)",
        },
      ];
    },
    fields: (raw) => collectionOf(raw)?.fields ?? [],
    fixedRoute: (raw) => collectionOf(raw)?.route,
    // Hidden, and outside the theme's `src/content` Obsidian vault, so it is not itself a post.
    manifestPath: () => '.capture/manifest.json',
    pathFor: (entry, raw) => {
      const contentDir = themeOf(raw)?.contentDir ?? 'src/content';
      const slug = routeVariables(entry).slug;
      return `${contentDir}/${opts(raw).collection}/${slug}.md`;
    },
    linkTo: (_from, to) => to.entry.route,
    render: (input, tools, raw) => {
      const collection = collectionOf(raw);
      if (collection === undefined) {
        return err(validation(`astro: unknown collection ${JSON.stringify(opts(raw).collection)}`));
      }
      const frontmatter = collection.frontmatter(input.entry, input.frontmatter);
      const yaml = tools.updateFrontmatter('', { set: frontmatter });
      if (!yaml.ok) return yaml;
      return ok(wrapFrontmatter(yaml.value) + input.body);
    },
  };
};
