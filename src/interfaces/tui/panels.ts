import type { MutationOutcome } from '../../application/mutations/mutate.js';
import { createPluginApi } from '../../application/plugin/api.js';
import type {
  EnabledPlugin,
  NotePlugin,
  PanelData,
  PanelNoteRef,
  PanelSpec,
  PluginApi,
  PluginRegistry,
} from '../../application/plugin/plugin.js';
import type { TuiServices } from './context.js';

/*
 * The panel host: how the TUI gives every panel, core or plugin, its `PluginApi` and reads
 * rows out of its data (docs/plugins.md §4). Core panels act with an API over the whole scope;
 * a plugin's panels get the plugin's own sub-scope, exactly like its commands.
 */

/** Stands in as the owner of `core.*` panels; it owns no types and has no settings. */
export const CORE_PLUGIN: NotePlugin = {
  name: 'core',
  description: 'the core screens',
  types: [],
  fields: [],
};

export const panelOwner = (registry: PluginRegistry, spec: PanelSpec): EnabledPlugin | 'core' =>
  registry.enabled.find((e) => e.plugin.panels?.includes(spec)) ?? 'core';

export const apiForPanel = (services: TuiServices, spec: PanelSpec): PluginApi => {
  const owner = panelOwner(services.registry, spec);
  const enabled: EnabledPlugin =
    owner === 'core' ? { plugin: CORE_PLUGIN, scope: services.scope, settings: new Map() } : owner;
  return createPluginApi(services.deps, services.registry, enabled, { cwd: services.cwd });
};

/** A note side panel shows for every note, or only for notes of a type its plugin owns. */
export const panelApplies = (
  registry: PluginRegistry,
  spec: PanelSpec,
  type: string | undefined,
): boolean => {
  if (spec.appliesTo === 'all') return true;
  const owner = panelOwner(registry, spec);
  if (owner === 'core') return spec.appliesTo !== 'owned';
  return type !== undefined && registry.ownerOf(type) === owner.plugin;
};

export const rowCount = (data: PanelData | undefined): number => {
  if (!data) return 0;
  switch (data.kind) {
    case 'list':
      return data.items.length;
    case 'table':
      return data.rows.length;
    case 'text':
      return 0;
  }
};

/** The row under the cursor as the panel's own data gave it (what actions receive). */
export const rowAt = (data: PanelData | undefined, cursor: number): unknown => {
  if (!data) return undefined;
  switch (data.kind) {
    case 'list':
      return data.items[cursor];
    case 'table':
      return data.rows[cursor];
    case 'text':
      return undefined;
  }
};

export const noteAt = (data: PanelData | undefined, cursor: number): PanelNoteRef | undefined => {
  if (!data) return undefined;
  switch (data.kind) {
    case 'list':
      return data.items[cursor]?.note;
    case 'table':
      return data.rows[cursor]?.note;
    case 'text':
      return undefined;
  }
};

export const outcomeText = (outcome: MutationOutcome | null): string => {
  if (outcome === null) return 'Nothing to do';
  if (outcome.dryRun) return `Would change ${outcome.path}`;
  return outcome.written ? `Updated ${outcome.path}` : `No change to ${outcome.path}`;
};
