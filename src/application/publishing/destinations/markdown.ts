import { wrapFrontmatter } from '../../../domain/note/frontmatter.js';
import { relativePath } from '../../../domain/publishing/output-path.js';
import { routeToPath } from '../../../domain/publishing/route.js';
import { ok } from '../../../domain/result.js';
import type { Destination } from '../destination.js';
import { parseLayoutOptions, type LayoutOptions } from './layout.js';

/*
 * The markdown destination writes each entry as a full Markdown file — frontmatter kept verbatim,
 * references turned into relative links to the other emitted files. It is the portable, tool-
 * agnostic output: drop the directory into any vault or any Markdown-aware generator.
 */
const options = (raw: unknown): LayoutOptions => raw as LayoutOptions;

export const markdownDestination: Destination = {
  kind: 'markdown',
  description: 'Full Markdown files with frontmatter kept and references as relative links',
  settings: (raw) => parseLayoutOptions(raw, 'flat'),
  fields: () => [],
  pathFor: (entry, raw) => routeToPath(entry.route, 'md', options(raw).layout),
  linkTo: (from, to) => relativePath(from.path, to.path),
  render: (input) =>
    ok((input.frontmatterYaml !== '' ? wrapFrontmatter(input.frontmatterYaml) : '') + input.body),
};
