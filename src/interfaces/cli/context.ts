import type { Command } from 'commander';
import type { PluginRegistry } from '../../application/plugin/plugin.js';
import { buildRegistry } from '../../application/plugin/registry.js';
import type { AppDeps, ExternalEditor } from '../../application/ports.js';
import { loadScope } from '../../application/vault/vault.js';
import type { AppError } from '../../domain/errors.js';
import type { Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { firstPartyPlugins } from '../../plugins/index.js';

export interface GlobalOptions {
  readonly json?: boolean;
  readonly cwd?: string;
  readonly scope?: string;
  readonly vault?: string[];
}

export interface CliContext {
  readonly deps: AppDeps;
  readonly cwd: string;
  readonly json: boolean;
  readonly scopeName?: string;
  readonly vaultRoots: readonly string[];
  readonly out: (text: string) => void;
  readonly errOut: (text: string) => void;
}

/** Launches the TUI on a loaded scope; wired by the composition root (`main.ts`). */
export type TuiLauncher = (scope: Scope, cwd: string) => Promise<Result<void, AppError>>;

export interface CliIo {
  readonly deps: AppDeps;
  readonly editor: ExternalEditor;
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly errOut: (text: string) => void;
  /** Absent where there is no terminal to draw on (tests, pipes). */
  readonly tui?: TuiLauncher;
  /** Asks the person at the terminal one question; absent when not interactive or `--json`. */
  readonly ask?: (question: string) => Promise<string>;
}

export const contextFor = (io: CliIo, command: Command): CliContext => {
  const options = command.optsWithGlobals<GlobalOptions>();
  return {
    deps: io.deps,
    cwd: options.cwd ?? io.cwd,
    json: options.json ?? false,
    ...(options.scope !== undefined && { scopeName: options.scope }),
    vaultRoots: options.vault ?? [],
    out: io.out,
    errOut: io.errOut,
  };
};

/** `--vault` roots, else `--scope`, else the nearest vault from the working directory. */
export const currentScope = (ctx: CliContext): Promise<Result<Scope, AppError>> =>
  loadScope(ctx.deps, {
    cwd: ctx.cwd,
    ...(ctx.scopeName !== undefined && { scope: ctx.scopeName }),
    vaults: ctx.vaultRoots,
  });

/** The plugins the scope's vaults enable; a conflicting configuration fails here (exit 6). */
export const registryFor = (scope: Scope): Result<PluginRegistry, AppError> =>
  buildRegistry(firstPartyPlugins, scope);

/**
 * Wraps a use case that needs the current scope. The plugin registry is built every time so
 * that a broken `plugins:` configuration is an error at vault open, whatever the command.
 */
export const inScopeWithPlugins =
  <T>(
    ctx: CliContext,
    work: (scope: Scope, registry: PluginRegistry) => Promise<Result<T, AppError>>,
  ) =>
  async (): Promise<Result<T, AppError>> => {
    const scope = await currentScope(ctx);
    if (!scope.ok) return scope;
    const registry = registryFor(scope.value);
    if (!registry.ok) return registry;
    return work(scope.value, registry.value);
  };

export const inScope = <T>(
  ctx: CliContext,
  work: (scope: Scope) => Promise<Result<T, AppError>>,
): (() => Promise<Result<T, AppError>>) => inScopeWithPlugins(ctx, (scope) => work(scope));
