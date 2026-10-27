import type { Command } from 'commander';
import type { AppDeps } from '../../application/ports.js';
import { loadScope } from '../../application/vault/vault.js';
import type { AppError } from '../../domain/errors.js';
import type { Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';

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

export interface CliIo {
  readonly deps: AppDeps;
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly errOut: (text: string) => void;
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

/** Wraps a use case that needs the current scope; scope loading errors pass straight through. */
export const inScope =
  <T>(ctx: CliContext, work: (scope: Scope) => Promise<Result<T, AppError>>) =>
  async (): Promise<Result<T, AppError>> => {
    const scope = await currentScope(ctx);
    if (!scope.ok) return scope;
    return work(scope.value);
  };
