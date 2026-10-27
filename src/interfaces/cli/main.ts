import { Command, CommanderError } from 'commander';
import { createRequire } from 'node:module';
import { createDeps, createInterfaceDeps } from '../../infrastructure/deps.js';
import { firstPartyPlugins } from '../../plugins/index.js';
import { runTui } from '../tui/tui.js';
import { registerCommands } from './commands.js';
import type { CliIo, TuiLauncher } from './context.js';
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

/*
 * Composition root. This is the one place that knows every adapter and both interfaces; the
 * TUI is only offered when there is a terminal to draw on.
 */
const deps = createDeps();
const { editor, watcher } = createInterfaceDeps();

const tui: TuiLauncher = (scope, cwd) =>
  runTui({
    deps,
    editor,
    watcher,
    plugins: firstPartyPlugins,
    scope,
    cwd,
    stdin: process.stdin,
    stdout: process.stdout,
  });

const io: CliIo = {
  deps,
  editor,
  cwd: process.cwd(),
  out: (text) => {
    if (text !== '') process.stdout.write(text + '\n');
  },
  errOut: (text) => {
    process.stderr.write(text + '\n');
  },
  ...(process.stdout.isTTY && process.stdin.isTTY && { tui }),
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
