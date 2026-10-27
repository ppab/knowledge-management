import { validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope, ScopeMember } from '../../domain/scope/scope.js';
import type {
  EnabledPlugin,
  FieldSpec,
  NotePlugin,
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
  /** Panels the host registers itself (`core.*`); plugin keys must not clash with them. */
  readonly core?: readonly PanelSpec[];
}

const fieldShape = (spec: FieldSpec): string =>
  [spec.type, spec.of ?? '', [...(spec.values ?? [])].sort().join('|')].join(':');

const enablingMembers = (
  scope: Scope,
  plugin: NotePlugin,
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
  plugins: readonly NotePlugin[],
  scope: Scope,
  options: RegistryOptions = {},
): Result<PluginRegistry, AppError> => {
  const byName = new Map<string, NotePlugin>();
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

  const owners = new Map<string, NotePlugin>();
  const fields = new Map<string, { plugin: NotePlugin; spec: FieldSpec }>();
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
    if (panel.key === undefined) continue;
    const slot = `${panel.placement}:${panel.key}`;
    const previous = keys.get(slot);
    if (previous) {
      return err(
        validation(
          `Key "${panel.key}" (${panel.placement}) is claimed by both ${previous.panel.id} (${previous.owner}) and ${panel.id} (${owner})`,
          { key: panel.key, placement: panel.placement, panels: [previous.panel.id, panel.id] },
        ),
      );
    }
    keys.set(slot, entry);
  }

  return ok({
    enabled,
    plugins: enabled.map((e) => e.plugin),
    ownerOf: (type) => owners.get(type),
    fieldsFor: (type) => owners.get(type)?.fields ?? [],
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
