import type { Command } from 'commander';
import { initVault } from '../../../application/vault/vault.js';
import { usage, type AppError } from '../../../domain/errors.js';
import type { IdentityConfig } from '../../../domain/identity/identity.js';
import { err, ok, type Result } from '../../../domain/result.js';
import type { Exit } from '../commands.js';
import { contextFor, type CliIo } from '../context.js';
import { emit } from '../output.js';

const identityFrom = (
  strategy: string | undefined,
  format: string | undefined,
): Result<IdentityConfig | undefined, AppError> => {
  if (strategy === undefined) {
    return format === undefined
      ? ok(undefined)
      : err(usage('--format requires --identity formatted'));
  }
  if (strategy === 'ulid' || strategy === 'uuidv7') return ok({ strategy });
  if (strategy === 'formatted') {
    return format === undefined
      ? err(usage('--identity formatted requires --format'))
      : ok({ strategy, format });
  }
  return err(usage(`Unknown identity strategy "${strategy}" (ulid, uuidv7, formatted)`));
};

export const registerInitCommand = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('init')
    .description('initialize a vault in the current directory')
    .option('--name <name>', 'vault name (defaults to the directory name)')
    .option('--identity <strategy>', 'id strategy: ulid | uuidv7 | formatted')
    .option(
      '--format <format>',
      'id format for the formatted strategy, e.g. "{vault}-{date}-{ulid}"',
    )
    .action(async (opts: { name?: string; identity?: string; format?: string }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          async () => {
            const identity = identityFrom(opts.identity, opts.format);
            if (!identity.ok) return identity;
            return initVault(ctx.deps, {
              dir: ctx.cwd,
              ...(opts.name !== undefined && { name: opts.name }),
              ...(identity.value !== undefined && { identity: identity.value }),
            });
          },
          (v) => `Initialized vault "${v.config.name}" (${v.config.id}) at ${v.root}`,
          (v) => ({ root: v.root, ...v.config }),
        ),
      );
    });
};
