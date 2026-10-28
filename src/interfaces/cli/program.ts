import { Command } from 'commander';
import { registerCommands } from './commands.js';
import type { CliIo } from './context.js';
import { VERSION } from './version.js';

/** The commander program with every command registered; `main.ts` parses it, tests drive it. */
export const buildProgram = (io: CliIo, exit: (code: number) => void): Command => {
  const program = new Command('notes')
    .description('Local-first, Git-native knowledge management')
    .version(VERSION)
    .option('--json', 'machine-readable output')
    .option('--cwd <dir>', 'run as if started in <dir>')
    .option('--scope <name>', 'operate on a named scope from the user config')
    .option(
      '--vault <path>',
      'operate on the vault at <path> (repeatable: several paths form a composite scope)',
      (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
    )
    .showHelpAfterError()
    .exitOverride();
  registerCommands(program, io, exit);
  return program;
};
