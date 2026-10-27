import type { Command } from 'commander';
import { usage } from '../../domain/errors.js';
import { err } from '../../domain/result.js';
import { registerCapabilitiesCommand } from './commands/capabilities.js';
import { registerInitCommand } from './commands/init.js';
import { registerMaintenanceCommands } from './commands/maintenance.js';
import { registerMutationCommands } from './commands/mutations.js';
import { registerNoteCommands } from './commands/notes.js';
import { registerPluginCommands } from './commands/plugins.js';
import { registerQueryCommands } from './commands/query.js';
import { contextFor, inScope, type CliIo } from './context.js';
import { emit } from './output.js';

export type Exit = (code: number) => void;

export const registerCommands = (program: Command, io: CliIo, exit: Exit): void => {
  // `notes` alone opens the TUI on the current scope (docs/plan.md M5).
  program.action(async (_opts: unknown, cmd: Command) => {
    const ctx = contextFor(io, cmd);
    exit(
      await emit(
        ctx,
        inScope(ctx, (scope) =>
          io.tui
            ? io.tui(scope, ctx.cwd)
            : Promise.resolve(
                err(
                  usage('The TUI needs an interactive terminal; run `notes --help` for commands'),
                ),
              ),
        ),
        () => '',
      ),
    );
  });
  registerInitCommand(program, io, exit);
  registerNoteCommands(program, io, exit);
  const reference = registerQueryCommands(program, io, exit);
  registerMutationCommands(program, reference, io, exit);
  registerMaintenanceCommands(program, io, exit);
  registerPluginCommands(program, io, exit);
  registerCapabilitiesCommand(program, io, exit);
};
