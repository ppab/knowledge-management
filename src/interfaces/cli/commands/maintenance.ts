import type { Command } from 'commander';
import { diagnose, type Diagnosis } from '../../../application/doctor/diagnose.js';
import {
  indexStatus,
  rebuildIndex,
  type IndexStatus,
} from '../../../application/index/refresh-index.js';
import type { AppError } from '../../../domain/errors.js';
import type { Result } from '../../../domain/result.js';
import type { AppDeps } from '../../../application/ports.js';
import type { VaultHandle } from '../../../application/vault/vault.js';
import type { NoteIndex } from '../../../application/ports.js';
import type { Exit } from '../commands.js';
import { contextFor, inVault, type CliIo } from '../context.js';
import { emit, EXIT_CODES } from '../output.js';

const withIndex =
  <T>(
    deps: AppDeps,
    work: (index: NoteIndex, vault: VaultHandle) => Promise<Result<T, AppError>>,
  ) =>
  async (vault: VaultHandle): Promise<Result<T, AppError>> => {
    const opened = await deps.indexes.open(vault.root);
    if (!opened.ok) return opened;
    try {
      return await work(opened.value, vault);
    } finally {
      opened.value.close();
    }
  };

const statusText = (status: IndexStatus): string => {
  const { stats, stale } = status;
  const lines = [
    `notes: ${String(stats.notes)} (${String(stats.unidentified)} unidentified)`,
    `references: ${String(stats.references)}`,
    `schema: v${String(stats.schemaVersion)}`,
  ];
  const changes = [
    ...stale.added.map((p) => `+ ${p}`),
    ...stale.modified.map((p) => `~ ${p}`),
    ...stale.removed.map((p) => `- ${p}`),
  ];
  lines.push(changes.length === 0 ? 'stale: none' : `stale: ${String(changes.length)}`);
  return [...lines, ...changes].join('\n');
};

const diagnosisText = (diagnosis: Diagnosis): string =>
  diagnosis.findings.length === 0
    ? 'No problems found.'
    : diagnosis.findings.map((f) => `${f.severity}: ${f.message}`).join('\n');

export const registerMaintenanceCommands = (program: Command, io: CliIo, exit: Exit): void => {
  const index = program.command('index').description('manage the derived search index');
  index
    .command('rebuild')
    .description('discard the index and rebuild it from the files')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(
            ctx,
            withIndex(ctx.deps, (idx, vault) => rebuildIndex(ctx.deps, vault, idx)),
          ),
          (report) =>
            `Indexed ${String(report.added.length)} files (${String(report.removed.length)} dropped).`,
        ),
      );
    });
  index
    .command('status')
    .description('report index size and which files are out of date')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(
            ctx,
            withIndex(ctx.deps, (idx, vault) => indexStatus(ctx.deps, vault, idx)),
          ),
          statusText,
        ),
      );
    });

  program
    .command('doctor')
    .description('check the vault: duplicate ids, dangling references, unidentified files')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      const state = { healthy: true };
      const code = await emit(
        ctx,
        inVault(ctx, async (vault) => {
          const result = await diagnose(ctx.deps, vault);
          if (result.ok) state.healthy = result.value.ok;
          return result;
        }),
        diagnosisText,
      );
      exit(code === 0 && !state.healthy ? EXIT_CODES.VALIDATION : code);
    });
};
