import { Command, CommanderError } from 'commander';
import { createRequire } from 'node:module';
import { createDeps } from '../../infrastructure/deps.js';
import { registerCommands } from './commands.js';
import type { CliIo } from './context.js';
import { EXIT_CODES } from './output.js';

const { version } = createRequire(import.meta.url)('../../../package.json') as { version: string };

export const buildProgram = (io: CliIo, exit: (code: number) => void): Command => {
  const program = new Command('notes')
    .description('Local-first, Git-native knowledge management')
    .version(version)
    .option('--json', 'machine-readable output')
    .option('--cwd <dir>', 'run as if started in <dir>')
    .option('--vault <path>', 'use the vault at <path> instead of discovering one')
    .showHelpAfterError()
    .exitOverride();
  registerCommands(program, io, exit);
  return program;
};

const io: CliIo = {
  deps: createDeps(),
  cwd: process.cwd(),
  out: (text) => {
    process.stdout.write(text + '\n');
  },
  errOut: (text) => {
    process.stderr.write(text + '\n');
  },
};

try {
  await buildProgram(io, (code) => {
    process.exitCode = code;
  }).parseAsync();
} catch (error) {
  if (error instanceof CommanderError) {
    const informational = ['commander.helpDisplayed', 'commander.version', 'commander.help'];
    process.exitCode = informational.includes(error.code) ? 0 : EXIT_CODES.USAGE;
  } else {
    io.errOut(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = EXIT_CODES.INTERNAL;
  }
}
