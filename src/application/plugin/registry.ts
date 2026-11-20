import { validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope, ScopeMember } from '../../domain/scope/scope.js';
import type { Destination } from '../publishing/destination.js';
import type { AstroTheme } from '../publishing/destinations/astro.js';
import {
  builtinDestinations,
  createAstroDestination,
  htmlDestination,
  markdownDestination,
  modularTheme,
} from '../publishing/destinations/index.js';
import { resolvePublications } from '../publishing/resolve-publications.js';
import type {
  EnabledPlugin,
  FieldSpec,
  EntryPlugin,
  PanelSpec,
  Placement,
  PluginRegistry,
} from './plugin.js';

/*
 * Built once per command from the composition root's plugin list and the vault configs in
 * the scope. A plugin is enabled when any available vault names it under `plugins:`; it then
 * sees only the members that enable it (plus unavailable ones, whose configs are unknown).
 * Every conflict is a configuration error (`VALIDATION`) that names both sides.
 */

export interface RegistryOptions {
  /** Panels the host registers itself (`core.*`); plugin chords must not clash with them. */
  readonly core?: readonly PanelSpec[];
  /** Overrides the built-in destination kinds (tests); defaults to `builtinDestinations`. */
  readonly destinations?: readonly Destination[];
}

const fieldShape = (spec: FieldSpec): string =>
  [spec.type, spec.of ?? '', [...(spec.values ?? [])].sort().join('|')].join(':');

const enablingMembers = (
  scope: Scope,
  plugin: EntryPlugin,
): { members: ScopeMember[]; settings: Map<string, unknown> } | null => {
  const members: ScopeMember[] = [];
  const settings = new Map<string, unknown>();
  let enabled = false;
  for (const member of scope.members) {
    if (!member.available) {
      members.push(member);
      continue;
    }
    const raw = member.vault.config.plugins?.[plugin.name];
    if (raw === undefined) continue;
    enabled = true;
    members.push(member);
    settings.set(member.root, raw);
  }
  return enabled ? { members, settings } : null;
};

export const buildRegistry = (
  plugins: readonly EntryPlugin[],
  scope: Scope,
  options: RegistryOptions = {},
): Result<PluginRegistry, AppError> => {
  const byName = new Map<string, EntryPlugin>();
  for (const plugin of plugins) {
    if (byName.has(plugin.name)) {
      return err(
        validation(`Plugin "${plugin.name}" is registered twice`, { plugin: plugin.name }),
      );
    }
    byName.set(plugin.name, plugin);
  }

  for (const member of scope.members) {
    if (!member.available) continue;
    for (const name of Object.keys(member.vault.config.plugins ?? {})) {
      if (!byName.has(name)) {
        return err(
          validation(`Vault ${member.vault.config.name} enables unknown plugin "${name}"`, {
            vault: member.vault.config.name,
            plugin: name,
            available: [...byName.keys()],
          }),
        );
      }
    }
  }

  const enabled: EnabledPlugin[] = [];
  for (const plugin of plugins) {
    const enabling = enablingMembers(scope, plugin);
    if (!enabling) continue;
    const settings = new Map<string, unknown>();
    for (const [root, raw] of enabling.settings) {
      const validated = plugin.settings ? plugin.settings(raw) : ok(raw);
      if (!validated.ok) {
        return err(
          validation(
            `Invalid settings for plugin "${plugin.name}" in ${root}: ${validated.error.message}`,
            { plugin: plugin.name, root, cause: validated.error },
          ),
        );
      }
      settings.set(root, validated.value);
    }
    enabled.push({
      plugin,
      scope: { ...(scope.name !== undefined && { name: scope.name }), members: enabling.members },
      settings,
    });
  }

  const owners = new Map<string, EntryPlugin>();
  const fields = new Map<string, { plugin: EntryPlugin; spec: FieldSpec }>();
  for (const { plugin } of enabled) {
    for (const type of plugin.types) {
      const other = owners.get(type);
      if (other) {
        return err(
          validation(`Type "${type}" is owned by both "${other.name}" and "${plugin.name}"`, {
            type,
            plugins: [other.name, plugin.name],
          }),
        );
      }
      owners.set(type, plugin);
    }
    for (const spec of plugin.fields) {
      const foreign = spec.types?.find((type) => !plugin.types.includes(type));
      if (foreign !== undefined) {
        return err(
          validation(
            `Field "${spec.name}" of "${plugin.name}" names type "${foreign}", which the plugin does not own`,
            { field: spec.name, plugin: plugin.name, type: foreign },
          ),
        );
      }
      const other = fields.get(spec.name);
      if (other && fieldShape(other.spec) !== fieldShape(spec)) {
        return err(
          validation(
            `Field "${spec.name}" is declared as ${other.spec.type} by "${other.plugin.name}" and as ${spec.type} by "${plugin.name}"`,
            { field: spec.name, plugins: [other.plugin.name, plugin.name] },
          ),
        );
      }
      fields.set(spec.name, { plugin, spec });
    }
  }

  const panels: { owner: string; panel: PanelSpec }[] = [
    ...(options.core ?? []).map((panel) => ({ owner: 'core', panel })),
    ...enabled.flatMap(({ plugin }) =>
      (plugin.panels ?? []).map((panel) => ({ owner: plugin.name, panel })),
    ),
  ];
  const ids = new Map<string, string>();
  const keys = new Map<string, { owner: string; panel: PanelSpec }>();
  for (const entry of panels) {
    const { owner, panel } = entry;
    const previousId = ids.get(panel.id);
    if (previousId !== undefined) {
      return err(
        validation(`Panel id "${panel.id}" is used by both "${previousId}" and "${owner}"`, {
          panel: panel.id,
          owners: [previousId, owner],
        }),
      );
    }
    ids.set(panel.id, owner);
    if (panel.chord === undefined) continue;
    const slot = `${panel.placement}:${panel.chord}`;
    const previous = keys.get(slot);
    if (previous) {
      return err(
        validation(
          `Chord "${panel.chord}" (${panel.placement}) is claimed by both ${previous.panel.id} (${previous.owner}) and ${panel.id} (${owner})`,
          { chord: panel.chord, placement: panel.placement, panels: [previous.panel.id, panel.id] },
        ),
      );
    }
    keys.set(slot, entry);
  }

  // Destination kinds: built-ins the host owns, plus kinds enabled plugins add. A kind belongs to
  // the core or to exactly one plugin — the same single-owner rule as types and panel chords.
  const baseDestinations = options.destinations ?? builtinDestinations;
  const baseKinds = new Set(baseDestinations.map((d) => d.kind));
  const destinationOwners = new Map<string, string>();
  for (const { plugin } of enabled) {
    for (const destination of plugin.destinations ?? []) {
      if (baseKinds.has(destination.kind)) {
        return err(
          validation(
            `Destination kind "${destination.kind}" of "${plugin.name}" shadows a built-in`,
            {
              kind: destination.kind,
              plugin: plugin.name,
            },
          ),
        );
      }
      const other = destinationOwners.get(destination.kind);
      if (other !== undefined) {
        return err(
          validation(
            `Destination kind "${destination.kind}" is declared by both "${other}" and "${plugin.name}"`,
            {
              kind: destination.kind,
              plugins: [other, plugin.name],
            },
          ),
        );
      }
      destinationOwners.set(destination.kind, plugin.name);
    }
  }

  // Astro themes: the built-in `modular` plus themes enabled plugins contribute to the `astro`
  // kind. A theme name belongs to the core or exactly one plugin — the same single-owner rule as
  // destination kinds and panel chords. The built-in astro is thus extended, not replaced.
  const themeOwners = new Map<string, string>([['modular', 'core']]);
  for (const { plugin } of enabled) {
    for (const theme of plugin.astroThemes ?? []) {
      const other = themeOwners.get(theme.name);
      if (other === 'core') {
        return err(
          validation(`Astro theme "${theme.name}" of "${plugin.name}" shadows the built-in`, {
            theme: theme.name,
            plugin: plugin.name,
          }),
        );
      }
      if (other !== undefined) {
        return err(
          validation(
            `Astro theme "${theme.name}" is declared by both "${other}" and "${plugin.name}"`,
            { theme: theme.name, plugins: [other, plugin.name] },
          ),
        );
      }
      themeOwners.set(theme.name, plugin.name);
    }
  }
  const themesFor = (root: string): AstroTheme[] => {
    const themes: AstroTheme[] = [modularTheme];
    for (const { plugin, scope: pluginScope } of enabled) {
      if (!plugin.astroThemes) continue;
      if (pluginScope.members.some((m) => m.available && m.root === root)) {
        themes.push(...plugin.astroThemes);
      }
    }
    return themes;
  };

  const destinationsFor = (root: string): readonly Destination[] => {
    // A test override replaces the whole base set; otherwise the astro kind is built per vault from
    // that vault's available themes, so its `theme` enum is exactly what the vault can use.
    const base = options.destinations ?? [
      markdownDestination,
      htmlDestination,
      createAstroDestination(themesFor(root)),
    ];
    const result = [...base];
    for (const { plugin, scope: pluginScope } of enabled) {
      if (!plugin.destinations) continue;
      if (pluginScope.members.some((m) => m.available && m.root === root)) {
        result.push(...plugin.destinations);
      }
    }
    return result;
  };

  const resolved = resolvePublications(scope, destinationsFor);
  if (!resolved.ok) return resolved;

  return ok({
    enabled,
    plugins: enabled.map((e) => e.plugin),
    destinationsFor,
    publications: () => resolved.value,
    ownerOf: (type) => owners.get(type),
    fieldsFor: (type) =>
      (owners.get(type)?.fields ?? []).filter(
        (s) => s.types === undefined || s.types.includes(type),
      ),
    panels: (placement: Placement) =>
      panels.filter((p) => p.panel.placement === placement).map((p) => p.panel),
    commands: () =>
      enabled.flatMap(({ plugin }) =>
        (plugin.commands ?? []).map((command) => ({ plugin, command })),
      ),
    checks: () =>
      enabled.flatMap(({ plugin }) => (plugin.checks ?? []).map((check) => ({ plugin, check }))),
    templates: () =>
      Object.fromEntries(
        enabled.flatMap(({ plugin }) =>
          Object.entries(plugin.templates ?? {}).map(([name, source]) => [
            `${plugin.name}/${name}`,
            source,
          ]),
        ),
      ),
  });
};

/** The enabled plugin by name, or `undefined` when no vault in the scope enables it. */
export const enabledPlugin = (registry: PluginRegistry, name: string): EnabledPlugin | undefined =>
  registry.enabled.find((e) => e.plugin.name === name);
