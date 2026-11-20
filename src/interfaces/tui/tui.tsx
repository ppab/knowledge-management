import { render } from 'ink';
import type { EntryPlugin, PluginRegistry } from '../../application/plugin/plugin.js';
import { buildRegistry } from '../../application/plugin/registry.js';
import type { AppDeps, ExternalEditor, FileWatcher } from '../../application/ports.js';
import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import { availableVaults, type Scope } from '../../domain/scope/scope.js';
import { App } from './App.js';
import { createChangeDispatcher } from './change-feed.js';
import { Splash } from './components/Splash.js';
import type { StatusMessage } from './context.js';
import { checkReservedChords, corePanels } from './core-panels.js';
import type { Screen } from './model.js';
import { createTheme, type Theme } from './theme.js';

/*
 * The TUI's composition: the registry with the core panels in it, the watcher adapted to a
 * change feed, and Ink on the alternate screen. The CLI's `main.ts` calls `runTui` when
 * `notes` is given no subcommand.
 */

/** The registry the TUI runs on: core panels first, then the enabled plugins' (plugins.md §4). */
export const buildTuiRegistry = (
  deps: AppDeps,
  scope: Scope,
  plugins: readonly EntryPlugin[],
): Result<PluginRegistry, AppError> => {
  const holder: { registry?: PluginRegistry } = {};
  const core = corePanels({
    deps,
    scope,
    registry: () => {
      if (!holder.registry) throw new Error('registry used before it was built');
      return holder.registry;
    },
  });
  const built = buildRegistry(plugins, scope, { core });
  if (!built.ok) return built;
  holder.registry = built.value;
  const reserved = checkReservedChords(built.value);
  if (!reserved.ok) return reserved;
  return ok(built.value);
};

export interface RunTuiOptions {
  readonly deps: AppDeps;
  readonly editor: ExternalEditor;
  readonly watcher: FileWatcher;
  readonly plugins: readonly EntryPlugin[];
  readonly scope: Scope;
  readonly cwd: string;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  /** For `NO_COLOR`; the process environment in production. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * The boot wordmark, played once on the alternate screen before the TUI. It resolves when the
 * splash finishes on its own or the user presses a key to skip it; with `NO_COLOR` or no tty there
 * is nothing to animate, so `Splash` paints the mark once and resolves straight away. `OFL_NO_SPLASH`
 * opts out entirely (scripts, demos). Kept separate from the main loop so it never replays across an
 * editor handoff.
 */
const playSplash = async (options: RunTuiOptions, theme: Theme): Promise<void> => {
  if ((options.env.OFL_NO_SPLASH ?? '') !== '') return;
  const animate = theme.colors && options.stdout.isTTY;
  await new Promise<void>((resolve) => {
    const instance = render(<Splash theme={theme} animate={animate} onDone={resolve} />, {
      stdin: options.stdin,
      stdout: options.stdout,
      alternateScreen: true,
      exitOnCtrlC: true,
      patchConsole: false,
    });
    void instance.waitUntilExit();
  });
};

export const runTui = async (options: RunTuiOptions): Promise<Result<void, AppError>> => {
  const { deps, scope } = options;
  const registry = buildTuiRegistry(deps, scope, options.plugins);
  if (!registry.ok) return registry;

  const dispatcher = createChangeDispatcher();
  const roots = availableVaults(scope).map((v) => v.root);
  const theme = createTheme(options.env);

  await playSplash(options, theme);

  // State that must outlive a single render: the screen stack (so the cursor, scroll and
  // selection survive an editor handoff) and a status to surface once the TUI is back.
  let stack: readonly Screen[] | undefined;
  let pendingStatus: StatusMessage | null = null;

  // An edit request parks here while the TUI tears itself down; `control.unmount` is the live
  // instance's unmount, swapped in after each render. `takeEdit` both reads and clears it, so the
  // request survives the `await` below with its type intact rather than narrowing to the clear.
  interface EditRequest {
    readonly file: string;
    readonly command?: string;
  }
  let editRequest: EditRequest | null = null;
  const control: { unmount: (() => void) | null } = { unmount: null };
  const requestEdit = (file: string, command?: string): void => {
    editRequest = { file, ...(command !== undefined && { command }) };
    control.unmount?.();
  };
  const takeEdit = (): EditRequest | null => {
    const request = editRequest;
    editRequest = null;
    return request;
  };

  /*
   * Each pass renders the TUI, then — if the user asked to edit rather than quit — hands the
   * terminal wholly to the editor. We stop the watcher and release stdin so the parent process
   * stays dormant for the duration (no reindexing, no Git, no input contention), which is what
   * keeps a heavy editor session smooth. The next pass re-renders from the preserved stack and
   * reloads from disk.
   */
  for (;;) {
    const stop = await options.watcher.watch(roots, () => {
      dispatcher.notify();
    });
    const instance = render(
      <App
        services={{ deps, scope, registry: registry.value, requestEdit, cwd: options.cwd, theme }}
        changes={dispatcher.feed}
        {...(stack !== undefined && { initial: stack })}
        initialStatus={pendingStatus}
        onStackChange={(next) => {
          stack = next;
        }}
      />,
      {
        stdin: options.stdin,
        stdout: options.stdout,
        alternateScreen: true,
        exitOnCtrlC: true,
        patchConsole: false,
      },
    );
    control.unmount = instance.unmount;
    pendingStatus = null;
    await instance.waitUntilExit();
    await stop();

    const request = takeEdit();
    if (request === null) break; // the user quit

    // Ink's teardown drops raw mode but does not stop libuv reading the tty, so the editor would
    // lose its first keystroke to this process. Pausing it ourselves hands input over cleanly;
    // the next render reclaims it. (Verified against a plain-spawn baseline.)
    options.stdin.pause();
    const result = await options.editor.open(
      request.file,
      request.command === undefined ? {} : { command: request.command },
    );
    if (!result.ok) {
      pendingStatus = {
        text: `${result.error.code.toLowerCase()}: ${result.error.message}`,
        level: 'error',
      };
    }
  }
  return ok(undefined);
};
