import { InvalidArgumentError, type Command } from 'commander';
import { createPluginApi } from '../../../application/plugin/api.js';
import type {
  CommandOption,
  CommandOutput,
  NotePlugin,
  PluginCommand,
} from '../../../application/plugin/plugin.js';
import { enabledPlugin } from '../../../application/plugin/registry.js';
import { usage } from '../../../domain/errors.js';
import { err } from '../../../domain/result.js';
import { firstPartyPlugins } from '../../../plugins/index.js';
import type { Exit } from '../commands.js';
import { contextFor, inScopeWithPlugins, type CliIo } from '../context.js';
import { emit, mutationText, table } from '../output.js';

/*
 * Every first-party plugin is a command group generated from its `PluginCommand`s. Whether
 * the group may run is decided per invocation, once the scope is known: a plugin no vault
 * enables answers with a usage error (exit 2), like an unknown command would.
 */

const optionFlags = (option: CommandOption): string =>
  option.value === undefined || option.value === 'boolean'
    ? `--${option.flag}`
    : `--${option.flag} <${option.value}>`;

const parseNumber = (value: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError('expected a number');
  return n;
};

const argumentSpec = (arg: { name: string; variadic?: boolean; optional?: boolean }): string => {
  const name = arg.variadic ? `${arg.name}...` : arg.name;
  return arg.optional ? `[${name}]` : `<${name}>`;
};

const outputText = (output: CommandOutput): string => {
  switch (output.kind) {
    case 'table':
      if (output.rows.length === 0) return output.empty ?? '';
      return table(output.header ? [output.header, ...output.rows] : output.rows);
    case 'lines':
      return output.lines.join('\n');
    case 'mutation':
      return mutationText(output.outcome);
  }
};

const outputJson = (output: CommandOutput): unknown =>
  output.kind === 'mutation' ? output.outcome : output.json;

const registerPluginCommand = (
  group: Command,
  plugin: NotePlugin,
  command: PluginCommand,
  io: CliIo,
  exit: Exit,
): void => {
  const sub = group.command(command.name).description(command.description);
  for (const arg of command.args ?? []) sub.argument(argumentSpec(arg), arg.description);
  for (const option of command.options ?? []) {
    if (option.value === 'number') sub.option(optionFlags(option), option.description, parseNumber);
    else sub.option(optionFlags(option), option.description);
  }
  sub.option('--dry-run', 'print the change as a diff and write nothing');
  sub.action(async (...invocation: unknown[]) => {
    // Commander passes the positional arguments, then the options object, then the command.
    const cmd = invocation[invocation.length - 1] as Command;
    const { dryRun, ...options } = invocation[invocation.length - 2] as {
      dryRun?: boolean;
      [key: string]: unknown;
    };
    const args = invocation
      .slice(0, -2)
      .flatMap((a) => (Array.isArray(a) ? (a as string[]) : [String(a)]));
    const ctx = contextFor(io, cmd);
    exit(
      await emit(
        ctx,
        inScopeWithPlugins(ctx, (scope, registry) => {
          const enabled = enabledPlugin(registry, plugin.name);
          if (!enabled) {
            return Promise.resolve(
              err(
                usage(
                  `Plugin "${plugin.name}" is not enabled in this scope; add "plugins: { ${plugin.name}: {} }" to .notes/config.yaml`,
                  { plugin: plugin.name, vaults: scope.members.map((m) => m.root) },
                ),
              ),
            );
          }
          const api = createPluginApi(ctx.deps, registry, enabled, { cwd: ctx.cwd });
          return command.run(api, { args, options, dryRun: dryRun ?? false });
        }),
        outputText,
        outputJson,
      ),
    );
  });
};

export const registerPluginCommands = (program: Command, io: CliIo, exit: Exit): void => {
  for (const plugin of firstPartyPlugins) {
    const group = program.command(plugin.name).description(`${plugin.description} (plugin)`);
    for (const command of plugin.commands ?? []) {
      registerPluginCommand(group, plugin, command, io, exit);
    }
  }
};
