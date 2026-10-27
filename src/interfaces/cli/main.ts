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
    // `--help`/`--version` exit 0; help shown because of a usage mistake carries exitCode 1.
    process.exitCode = error.exitCode === 0 ? 0 : EXIT_CODES.USAGE;
  } else {
    io.errOut(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = EXIT_CODES.INTERNAL;
  }
}
