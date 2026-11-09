import { wrapFrontmatter } from '../../../domain/entry/frontmatter.js';
import { relativePath } from '../../../domain/publishing/output-path.js';
import { routeToPath, type Layout } from '../../../domain/publishing/route.js';
import { ok } from '../../../domain/result.js';
import type { Destination } from '../destination.js';

/*
 * The markdown destination writes each entry as a full Markdown file — frontmatter kept verbatim,
 * references turned into relative links to the other emitted files. It is the portable, tool-
 * agnostic output: drop the directory into any vault or any Markdown-aware generator.
 */
const layoutOf = (raw: unknown): Layout => (raw as { layout: Layout }).layout;

export const markdownDestination: Destination = {
  kind: 'markdown',
  description: 'Full Markdown files with frontmatter kept and references as relative links',
  options: () => [
    {
      name: 'layout',
      type: 'enum',
      values: ['flat', 'directory'],
      default: 'flat',
      description: 'file layout: flat `slug.md` or `slug/index.md`',
    },
  ],
  fields: () => [],
  pathFor: (entry, raw) => routeToPath(entry.route, 'md', layoutOf(raw)),
  linkTo: (from, to) => relativePath(from.path, to.path),
  render: (input) =>
    ok((input.frontmatterYaml !== '' ? wrapFrontmatter(input.frontmatterYaml) : '') + input.body),
};
