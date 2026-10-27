import { boundDates } from '../../application/calendar/calendar.js';
import { isoDate } from '../../application/notes/create-note.js';
import type { PanelSpec, Placement, PluginRegistry } from '../../application/plugin/plugin.js';
import { describeFields } from '../../application/plugin/validate-fields.js';
import type { AppDeps } from '../../application/ports.js';
import { backlinks } from '../../application/references/references.js';
import { monthRange, yearMonthOf } from '../../domain/calendar/month-grid.js';
import { validation, type AppError } from '../../domain/errors.js';
import { extractFields } from '../../domain/note/fields.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';

/*
 * The core's own panels, registered through the same registry as plugin panels so key and id
 * collisions are caught once, at startup (docs/plugins.md §4). `core.calendar` is rendered by
 * the dedicated Calendar screen; its `load` exists so the generic path can show it too.
 */

export interface CorePanelDeps {
  readonly deps: AppDeps;
  readonly scope: Scope;
  /** The registry is built from these panels, so it is looked up lazily. */
  readonly registry: () => PluginRegistry;
}

export const corePanels = ({ deps, scope, registry }: CorePanelDeps): PanelSpec[] => [
  {
    id: 'core.metadata',
    title: 'Metadata',
    placement: 'note',
    key: 'm',
    appliesTo: 'all',
    load: (_api, context) => {
      const located = context.note;
      if (!located) return Promise.resolve(ok({ kind: 'text', lines: [] }));
      const note = located.note;
      const lines = [`id: ${note.id}`, `path: ${note.path}`, `vault: ${located.vault.config.name}`];
      if (note.type !== undefined) lines.push(`type: ${note.type}`);
      if (note.created !== undefined) lines.push(`created: ${note.created}`);
      if (note.aliases.length) lines.push(`aliases: ${note.aliases.join(', ')}`);
      if (note.dates.length) lines.push(`dates: ${note.dates.join(', ')}`);
      if (note.tags.length) lines.push(`tags: ${note.tags.join(', ')}`);
      lines.push(`visibility: ${note.visibility}`);
      const owner = note.type === undefined ? undefined : registry().ownerOf(note.type);
      if (owner) {
        const fields = describeFields(owner.fields, extractFields(note.frontmatter));
        lines.push('', `fields (${owner.name}):`);
        for (const f of fields.declared) {
          const value =
            f.value === undefined
              ? '-'
              : typeof f.value === 'string'
                ? f.value
                : JSON.stringify(f.value);
          lines.push(`  ${f.name}: ${value} (${f.type})${f.issue ? ` ! ${f.issue.message}` : ''}`);
        }
        if (fields.undeclared.length) lines.push(`  undeclared: ${fields.undeclared.join(', ')}`);
      }
      return Promise.resolve(ok({ kind: 'text', lines }));
    },
  },
  {
    id: 'core.backlinks',
    title: 'Backlinks',
    placement: 'note',
    key: 'B',
    appliesTo: 'all',
    load: async (_api, context) => {
      const located = context.note;
      if (!located) return ok({ kind: 'list', items: [] });
      const listing = await backlinks(deps, scope, located.note.id);
      if (!listing.ok) return listing;
      return ok({
        kind: 'list',
        items: listing.value.backlinks.map((link) => ({
          id: `${link.vault}:${link.source.path}:${String(link.range.start)}`,
          title: link.source.title,
          detail: link.label === undefined ? link.vault : `${link.vault} · "${link.label}"`,
          note: {
            vault: link.vault,
            path: link.source.path,
            ...(link.source.kind === 'note' && { id: link.source.id }),
          },
        })),
      });
    },
  },
  {
    id: 'core.calendar',
    title: 'Calendar',
    placement: 'home',
    key: 'c',
    load: async (api) => {
      const hits = await boundDates(deps, scope, monthRange(yearMonthOf(isoDate(api.clock.now()))));
      if (!hits.ok) return hits;
      return ok({
        kind: 'list',
        items: hits.value.map((hit) => ({
          id: `${hit.vault}:${hit.entry.path}:${hit.date}`,
          title: hit.entry.title,
          detail: hit.date,
          note: { vault: hit.vault, path: hit.entry.path, id: hit.entry.id },
        })),
      });
    },
  },
];

/** Keys the screens bind themselves, which no panel may claim (docs/architecture.md §6). */
export const RESERVED_KEYS: Readonly<Record<Placement, readonly string[]>> = {
  home: ['j', 'k', 'g', 'G', '/', 't', 'n', 'q'],
  note: ['h', 'j', 'k', 'l', 'w', 'b', '0', '$', 'g', 'G', 'e', 's', 'i', 'a', 'I', 'v', 'H'],
  list: [],
};

/** A plugin panel bound to a screen key is a startup error naming both sides. */
export const checkReservedKeys = (registry: PluginRegistry): Result<void, AppError> => {
  for (const placement of Object.keys(RESERVED_KEYS) as Placement[]) {
    for (const panel of registry.panels(placement)) {
      if (panel.id.startsWith('core.') || panel.key === undefined) continue;
      if (RESERVED_KEYS[placement].includes(panel.key)) {
        return err(
          validation(
            `Panel ${panel.id} claims key "${panel.key}", which the ${placement} screen binds itself`,
            { panel: panel.id, key: panel.key, placement },
          ),
        );
      }
    }
  }
  return ok(undefined);
};
