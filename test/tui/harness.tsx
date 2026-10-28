import { EventEmitter } from 'node:events';
import { render } from 'ink';
import type { ReactElement } from 'react';
import { buildTuiRegistry } from '../../src/interfaces/tui/tui.js';
import { createTheme } from '../../src/interfaces/tui/theme.js';
import { App } from '../../src/interfaces/tui/App.js';
import type { ChangeFeed, TuiServices } from '../../src/interfaces/tui/context.js';
import type { Screen } from '../../src/interfaces/tui/model.js';
import type { NotePlugin } from '../../src/application/plugin/plugin.js';
import type { ExternalEditor } from '../../src/application/ports.js';
import { ok } from '../../src/domain/result.js';
import { fixture, type Fixture } from '../fakes/index.js';

/*
 * Drives the real Ink runtime with injected streams, like ink-testing-library does, but with a
 * configurable terminal size and a stdin that records raw-mode changes (needed to prove the
 * editor handoff restores the terminal).
 */

class FakeStdout extends EventEmitter {
  readonly frames: string[] = [];
  isTTY = false;
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }
  // Ink waits for write callbacks before it settles `waitUntilExit`.
  write = (frame: string, ...rest: unknown[]): boolean => {
    this.frames.push(frame);
    const callback = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    callback?.();
    return true;
  };
  lastFrame = (): string => this.frames[this.frames.length - 1] ?? '';
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  readonly rawMode: boolean[] = [];
  private data: string | null = null;
  setRawMode = (on: boolean): void => {
    this.rawMode.push(on);
  };
  setEncoding = (): void => undefined;
  resume = (): void => undefined;
  pause = (): void => undefined;
  ref = (): void => undefined;
  unref = (): void => undefined;
  read = (): string | null => {
    const d = this.data;
    this.data = null;
    return d;
  };
  write = (data: string): void => {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;
const stripAnsi = (text: string): string => text.replace(ANSI, '');

export const KEYS = {
  enter: '\r',
  escape: '\u001B',
  tab: '\t',
  shiftTab: '\u001B[Z',
  backspace: '\u007F',
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  pageDown: '\u001B[6~',
  pageUp: '\u001B[5~',
  ctrlO: '\u000F',
  ctrlD: '\u0004',
  ctrlU: '\u0015',
  ctrlF: '\u0006',
  ctrlB: '\u0002',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Terminal {
  readonly stdin: FakeStdin;
  readonly stdout: FakeStdout;
  /** The latest frame without colours. */
  frame(): string;
  /** Sends keys one at a time, yielding to the event loop in between. */
  press(...keys: string[]): Promise<void>;
  /** Types `text` character by character. */
  type(text: string): Promise<void>;
  /** Waits until the frame satisfies `predicate` (or contains the text). */
  waitFor(what: string | ((frame: string) => boolean), timeoutMs?: number): Promise<string>;
  waitUntilExit(): Promise<void>;
  unmount(): void;
}

export interface TerminalOptions {
  readonly columns?: number;
  readonly rows?: number;
  /** Forces Ink's interactive mode (frames then carry escape codes). */
  readonly interactive?: boolean;
}

export const renderTerminal = (element: ReactElement, options: TerminalOptions = {}): Terminal => {
  const stdout = new FakeStdout(options.columns ?? 80, options.rows ?? 20);
  const stdin = new FakeStdin();
  if (options.interactive) stdout.isTTY = true;
  const stderr = new FakeStdout(80, 20);
  const instance = render(element, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    debug: !options.interactive,
    exitOnCtrlC: false,
    patchConsole: false,
    ...(options.interactive !== undefined && { interactive: options.interactive }),
  });
  // Interactive mode writes incremental updates, so only the whole output is meaningful there.
  const frame = () =>
    options.interactive ? stripAnsi(stdout.frames.join('')) : stripAnsi(stdout.lastFrame());
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key);
      await sleep(40); // above Ink's 20 ms escape-sequence flush delay
    }
  };
  return {
    stdin,
    stdout,
    frame,
    press,
    type: (text) => press(...Array.from(text)),
    waitFor: async (what, timeoutMs = 4000) => {
      const test = typeof what === 'string' ? (f: string) => f.includes(what) : what;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (test(frame())) return frame();
        await sleep(10);
      }
      throw new Error(
        `Timed out waiting for ${typeof what === 'string' ? JSON.stringify(what) : 'predicate'}.\nLast frame:\n${frame()}`,
      );
    },
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
    unmount: () => {
      instance.unmount();
    },
  };
};

export interface FakeEditor extends ExternalEditor {
  readonly calls: { file: string; command?: string }[];
}

/** Records calls and runs `onOpen` so a test can play the user editing the file. */
export const fakeEditor = (onOpen?: (file: string) => void | Promise<void>): FakeEditor => {
  const calls: { file: string; command?: string }[] = [];
  return {
    calls,
    open: async (file, options = {}) => {
      calls.push({ file, ...(options.command !== undefined && { command: options.command }) });
      await onOpen?.(file);
      return ok(undefined);
    },
  };
};

export const fakeChanges = (): ChangeFeed & { fire(): void } => {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fire: () => {
      listeners.forEach((l) => {
        l();
      });
    },
  };
};

export interface Harness {
  readonly f: Fixture;
  readonly services: TuiServices;
  readonly changes: ReturnType<typeof fakeChanges>;
  readonly editor: FakeEditor;
  start(initial?: readonly Screen[], options?: TerminalOptions): Terminal;
}

/** A fixture vault plus TUI services; `start` renders the app on a fake terminal. */
export const harness = (
  setup: (f: Fixture) => void,
  options: {
    plugins?: readonly NotePlugin[];
    editor?: FakeEditor;
    scope?: (f: Fixture) => Fixture['scope'];
  } = {},
): Harness => {
  const f = fixture(
    options.plugins && options.plugins.length > 0 ? { plugins: { todos: {} } } : {},
  );
  setup(f);
  // Re-read the scope after setup so a test can change the vault config (e.g. its editor).
  const scope = options.scope ? options.scope(f) : f.scopeOf('/vault');
  const registry = buildTuiRegistry(f.deps, scope, options.plugins ?? []);
  if (!registry.ok) throw new Error(registry.error.message);
  const editor = options.editor ?? fakeEditor();
  const services: TuiServices = {
    deps: f.deps,
    scope,
    registry: registry.value,
    editor,
    cwd: '/vault',
    theme: createTheme({}),
  };
  const changes = fakeChanges();
  return {
    f,
    services,
    changes,
    editor,
    start: (initial, terminal) =>
      renderTerminal(
        <App services={services} changes={changes} {...(initial && { initial })} />,
        terminal,
      ),
  };
};
