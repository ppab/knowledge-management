import { render } from 'ink';
import type { NotePlugin, PluginRegistry } from '../../application/plugin/plugin.js';
import { buildRegistry } from '../../application/plugin/registry.js';
import type { AppDeps, ExternalEditor, FileWatcher } from '../../application/ports.js';
import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import { availableVaults, type Scope } from '../../domain/scope/scope.js';
import { App } from './App.js';
import type { ChangeFeed } from './context.js';
import { checkReservedChords, corePanels } from './core-panels.js';
import { createTheme } from './theme.js';

/*
 * The TUI's composition: the registry with the core panels in it, the watcher adapted to a
 * change feed, and Ink on the alternate screen. The CLI's `main.ts` calls `runTui` when
 * `notes` is given no subcommand.
 */

/** The registry the TUI runs on: core panels first, then the enabled plugins' (plugins.md §4). */
export const buildTuiRegistry = (
  deps: AppDeps,
  scope: Scope,
  plugins: readonly NotePlugin[],
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
  readonly plugins: readonly NotePlugin[];
  readonly scope: Scope;
  readonly cwd: string;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  /** For `NO_COLOR`; the process environment in production. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export const runTui = async (options: RunTuiOptions): Promise<Result<void, AppError>> => {
  const { deps, scope } = options;
  const registry = buildTuiRegistry(deps, scope, options.plugins);
  if (!registry.ok) return registry;

  const listeners = new Set<() => void>();
  const changes: ChangeFeed = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const stop = await options.watcher.watch(
    availableVaults(scope).map((v) => v.root),
    () => {
      listeners.forEach((l) => {
        l();
      });
    },
  );
  const instance = render(
    <App
      services={{
        deps,
        scope,
        registry: registry.value,
        editor: options.editor,
        cwd: options.cwd,
        theme: createTheme(options.env),
      }}
      changes={changes}
    />,
    {
      stdin: options.stdin,
      stdout: options.stdout,
      alternateScreen: true,
      exitOnCtrlC: true,
      patchConsole: false,
    },
  );
  try {
    await instance.waitUntilExit();
  } finally {
    await stop();
  }
  return ok(undefined);
};
