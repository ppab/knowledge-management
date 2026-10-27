import type { Command } from 'commander';
import type { AppDeps } from '../../application/ports.js';
import { openVault, type VaultHandle } from '../../application/vault/vault.js';
import type { AppError } from '../../domain/errors.js';
import type { Result } from '../../domain/result.js';

export interface GlobalOptions {
  readonly json?: boolean;
  readonly cwd?: string;
  readonly vault?: string;
}

export interface CliContext {
  readonly deps: AppDeps;
  readonly cwd: string;
  readonly json: boolean;
  readonly vaultRoot?: string;
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
    ...(options.vault !== undefined && { vaultRoot: options.vault }),
    out: io.out,
    errOut: io.errOut,
  };
};

export const currentVault = (ctx: CliContext): Promise<Result<VaultHandle, AppError>> =>
  openVault(ctx.deps, {
    cwd: ctx.cwd,
    ...(ctx.vaultRoot !== undefined && { root: ctx.vaultRoot }),
  });
