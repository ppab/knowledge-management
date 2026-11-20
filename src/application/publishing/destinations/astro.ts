import { validation } from '../../../domain/errors.js';
import { wrapFrontmatter } from '../../../domain/entry/frontmatter.js';
import type { PlanEntry } from '../../../domain/publishing/plan.js';
import { routeVariables } from '../../../domain/publishing/route.js';
import { err, ok } from '../../../domain/result.js';
import { renderTemplate } from '../../../domain/template/render.js';
import type { FieldSpec } from '../../plugin/plugin.js';
import type { Destination, EntryProblem, RenderTools } from '../destination.js';

/*
 * The astro destination writes Markdown into an Astro content collection. Astro is chosen for the
 * MVP because the target theme is SEO-ready (sitemap, RSS, OG images, noIndex, meta description).
 *
 * `astro` is the kind; a `theme` option picks a profile that owns the real contract. The theme is
 * the public extension point (`AstroTheme`): data plus, per collection, a URL shape, the source
 * fields doctor checks, and the mapping from an entry's core metadata onto the theme's frontmatter.
 * The destination itself is theme-agnostic. It is built by a factory over a set of themes, so the
 * registry can aggregate the built-in `modular` profile with themes any enabled plugin contributes
 * and themes the vault itself declares under `.ofl/astro-themes/` (ADR 0009).
 */

/** One publish target the theme defines: a content collection with its own URL and schema. */
export interface AstroCollection {
  /** The collection's URL shape, e.g. `/posts/{{slug}}/`. */
  readonly route: string;
  /**
   * File path under the theme's `contentDir`, with `{{slug}}`, `{{id}}` or `{{stem}}`, e.g.
   * `notebook/en/{{slug}}.md` for a site that keeps one folder per locale. Default
   * `<collection>/{{slug}}.md`.
   */
  readonly path?: string;
  /** `forbid` refuses an entry whose body contains an image: publishing does not copy assets. */
  readonly images?: 'allow' | 'forbid';
  /** The collection's frontmatter schema, minus the keys the core maps itself. */
  readonly fields: readonly FieldSpec[];
  /** Problems that refuse the publication (see `Destination.entryProblems`). */
  problems?(entry: PlanEntry): readonly EntryProblem[];
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

/** Fenced and inline code, where an `<img>` is text about HTML rather than an image. */
const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;

/** True when the Markdown would show an image: `![alt](src)` syntax or a raw `<img>` tag. */
const hasImage = (body: string, tools: RenderTools): boolean =>
  /<img\b/i.test(tools.toHtml(body)) || /<img\b/i.test(body.replace(CODE, ''));

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
    entryProblems: (entry, raw) => collectionOf(raw)?.problems?.(entry) ?? [],
    fixedRoute: (raw) => collectionOf(raw)?.route,
    // Hidden, and outside the theme's `src/content` Obsidian vault, so it is not itself a post.
    manifestPath: () => '.capture/manifest.json',
    pathFor: (entry, raw) => {
      const contentDir = themeOf(raw)?.contentDir ?? 'src/content';
      const { slug, id, stem } = routeVariables(entry);
      const template = collectionOf(raw)?.path ?? `${opts(raw).collection}/{{slug}}.md`;
      // An unknown placeholder leaves the path empty, which the publish refuses as a bad path.
      const path = renderTemplate(template, { slug, id, stem });
      return path.ok ? `${contentDir}/${path.value}` : '';
    },
    linkTo: (_from, to) => to.entry.route,
    render: (input, tools, raw) => {
      const collection = collectionOf(raw);
      if (collection === undefined) {
        return err(validation(`astro: unknown collection ${JSON.stringify(opts(raw).collection)}`));
      }
      if (collection.images === 'forbid' && hasImage(input.body, tools)) {
        return err(
          validation(
            `${input.entry.path} contains an image, which collection "${opts(raw).collection}" does not accept (publishing does not copy images yet)`,
            { path: input.entry.path, collection: opts(raw).collection },
          ),
        );
      }
      const frontmatter = collection.frontmatter(input.entry, input.frontmatter);
      const yaml = tools.updateFrontmatter('', { set: frontmatter });
      if (!yaml.ok) return yaml;
      return ok(wrapFrontmatter(yaml.value) + input.body);
    },
  };
};
