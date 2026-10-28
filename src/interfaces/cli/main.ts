import { CommanderError } from 'commander';
import { createInterface } from 'node:readline/promises';
import { createDeps, createInterfaceDeps } from '../../infrastructure/deps.js';
import { firstPartyPlugins } from '../../plugins/index.js';
import { runTui } from '../tui/tui.js';
import type { CliIo, TuiLauncher } from './context.js';
import { EXIT_CODES } from './output.js';
import { buildProgram } from './program.js';

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
    env: process.env,
  });

const interactive = process.stdout.isTTY && process.stdin.isTTY;

const ask = async (question: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

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
  ...(interactive && { tui, ask }),
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
