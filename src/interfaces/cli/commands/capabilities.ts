import type { Command } from 'commander';
import type { NotePlugin } from '../../../application/plugin/plugin.js';
import { ok } from '../../../domain/result.js';
import { firstPartyPlugins } from '../../../plugins/index.js';
import type { Exit } from '../commands.js';
import { contextFor, currentScope, registryFor, type CliIo } from '../context.js';
import { emit, EXIT_CODES } from '../output.js';

/*
 * What an agent reads instead of this repository's docs: every command as commander knows it,
 * the exit codes, and the plugins with what they declare. Enablement depends on the scope, so
 * it is reported when a scope can be loaded and left out otherwise.
 */

interface CommandDescription {
  readonly name: string;
  readonly description: string;
  readonly args: readonly { name: string; description: string; required: boolean }[];
  readonly options: readonly { flags: string; description: string }[];
  readonly commands: readonly CommandDescription[];
}

const describeCommand = (command: Command): CommandDescription => ({
  name: command.name(),
  description: command.description(),
  args: command.registeredArguments.map((a) => ({
    name: a.name(),
    description: a.description,
    required: a.required,
  })),
  options: command.options
    .filter((o) => !o.hidden)
    .map((o) => ({ flags: o.flags, description: o.description })),
  commands: command.commands.map(describeCommand),
});

const describePlugin = (plugin: NotePlugin, enabled: boolean | undefined) => ({
  name: plugin.name,
  description: plugin.description,
  ...(enabled !== undefined && { enabled }),
  types: plugin.types,
  fields: plugin.fields,
  templates: Object.keys(plugin.templates ?? {}).map((name) => `${plugin.name}/${name}`),
  commands: (plugin.commands ?? []).map((c) => ({
    name: `${plugin.name} ${c.name}`,
    description: c.description,
    args: c.args ?? [],
    options: c.options ?? [],
  })),
  checks: (plugin.checks ?? []).map((c) => ({
    kind: `${plugin.name}:${c.kind}`,
    description: c.description,
  })),
  panels: (plugin.panels ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    placement: p.placement,
    ...(p.chord !== undefined && { chord: p.chord }),
    actions: (p.actions ?? []).map((a) => ({ key: a.key, label: a.label })),
  })),
});

export const registerCapabilitiesCommand = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('capabilities')
    .description('describe the commands, exit codes and plugins this binary offers')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          async () => {
            const scope = await currentScope(ctx);
            const registry = scope.ok ? registryFor(scope.value) : undefined;
            if (registry && !registry.ok) return registry;
            const enabledNames = new Set(registry?.value.plugins.map((p) => p.name));
            return ok({
              version: program.version() ?? '',
              commands: program.commands.map(describeCommand),
              exitCodes: EXIT_CODES,
              plugins: firstPartyPlugins.map((p) =>
                describePlugin(p, registry ? enabledNames.has(p.name) : undefined),
              ),
            });
          },
          (caps) =>
            [
              'commands:',
              ...caps.commands.map((c) => `  ${c.name}  ${c.description}`),
              'plugins:',
              ...caps.plugins.map(
                (p) =>
                  `  ${p.name}  ${p.description}${p.enabled === undefined ? '' : p.enabled ? ' [enabled]' : ' [disabled]'}`,
              ),
            ].join('\n'),
        ),
      );
    });
};
