import { routeToPath } from '../../../domain/publishing/route.js';
import { ok } from '../../../domain/result.js';
import type { FieldSpec } from '../../plugin/plugin.js';
import type { Destination } from '../destination.js';
import { parseLayoutOptions, type LayoutOptions } from './layout.js';

/*
 * The html destination writes each entry's body as an HTML fragment (no document wrapper — the
 * layout belongs to the static-site generator, assumption A7). Links point at the target's
 * route, so a server resolves them; the manifest carries the structure around them.
 *
 * It declares one source field, `description`, to exercise the declared-field path end to end:
 * doctor warns when a selected note lacks it, and it is copied into the manifest when present.
 */
const options = (raw: unknown): LayoutOptions => raw as LayoutOptions;

const FIELDS: readonly FieldSpec[] = [
  { name: 'description', type: 'string', description: 'summary for the manifest and meta tags' },
];

export const htmlDestination: Destination = {
  kind: 'html',
  description: 'HTML body fragments with route-based links, for a static-site generator',
  settings: (raw) => parseLayoutOptions(raw, 'directory'),
  fields: () => FIELDS,
  pathFor: (entry, raw) => routeToPath(entry.route, 'html', options(raw).layout),
  linkTo: (_from, to) => to.entry.route,
  render: (input, tools) => ok(tools.toHtml(input.body)),
};
