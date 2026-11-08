import { routeToPath, type Layout } from '../../../domain/publishing/route.js';
import { ok } from '../../../domain/result.js';
import type { FieldSpec } from '../../plugin/plugin.js';
import type { Destination } from '../destination.js';

/*
 * The html destination writes each entry's body as an HTML fragment (no document wrapper — the
 * layout belongs to the static-site generator, assumption A7). Links point at the target's
 * route, so a server resolves them; the manifest carries the structure around them.
 *
 * It declares one source field, `description`, to exercise the declared-field path end to end:
 * doctor warns when a selected note lacks it, and it is copied into the manifest when present.
 */
const layoutOf = (raw: unknown): Layout => (raw as { layout: Layout }).layout;

const FIELDS: readonly FieldSpec[] = [
  { name: 'description', type: 'string', description: 'summary for the manifest and meta tags' },
];

export const htmlDestination: Destination = {
  kind: 'html',
  description: 'HTML body fragments with route-based links, for a static-site generator',
  options: () => [
    {
      name: 'layout',
      type: 'enum',
      values: ['flat', 'directory'],
      default: 'directory',
      description: 'file layout: flat `slug.html` or `slug/index.html`',
    },
  ],
  fields: () => FIELDS,
  pathFor: (entry, raw) => routeToPath(entry.route, 'html', layoutOf(raw)),
  linkTo: (_from, to) => to.entry.route,
  render: (input, tools) => ok(tools.toHtml(input.body)),
};
