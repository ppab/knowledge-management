import type { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerMaintenanceCommands } from './commands/maintenance.js';
import { registerMutationCommands } from './commands/mutations.js';
import { registerNoteCommands } from './commands/notes.js';
import { registerQueryCommands } from './commands/query.js';
import type { CliIo } from './context.js';

export type Exit = (code: number) => void;

export const registerCommands = (program: Command, io: CliIo, exit: Exit): void => {
  registerInitCommand(program, io, exit);
  registerNoteCommands(program, io, exit);
  const reference = registerQueryCommands(program, io, exit);
  registerMutationCommands(program, reference, io, exit);
  registerMaintenanceCommands(program, io, exit);
};
