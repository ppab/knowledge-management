import type { Command } from 'commander';
import { diagnose, type Diagnosis } from '../../../application/doctor/diagnose.js';
import {
  indexStatus,
  rebuildIndex,
  type IndexStatus,
  type RefreshReport,
} from '../../../application/index/refresh-index.js';
import type { AppDeps, NoteIndex } from '../../../application/ports.js';
import { describeScope, listScopes } from '../../../application/scope/scope-info.js';
import { loadScope, type VaultHandle } from '../../../application/vault/vault.js';
import type { AppError } from '../../../domain/errors.js';
import { ok, type Result } from '../../../domain/result.js';
import { availableVaults, isComposite, type Scope } from '../../../domain/scope/scope.js';
import type { Exit } from '../commands.js';
import { contextFor, currentScope, inScope, type CliIo } from '../context.js';
import { emit, EXIT_CODES, table } from '../output.js';

/** Runs `work` against every available vault of the scope, one index at a time. */
const perVault =
  <T>(
    deps: AppDeps,
    work: (index: NoteIndex, vault: VaultHandle) => Promise<Result<T, AppError>>,
  ) =>
  async (scope: Scope): Promise<Result<{ vault: string; result: T }[], AppError>> => {
    const results: { vault: string; result: T }[] = [];
    for (const vault of availableVaults(scope)) {
      const opened = await deps.indexes.open(vault.root);
      if (!opened.ok) return opened;
      try {
        const result = await work(opened.value, vault);
        if (!result.ok) return result;
        results.push({ vault: vault.config.name, result: result.value });
      } finally {
        opened.value.close();
      }
    }
    return ok(results);
  };

const statusText = ({ stats, stale }: IndexStatus): string => {
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

const rebuildText = (report: RefreshReport): string =>
  `Indexed ${String(report.added.length)} files (${String(report.removed.length)} dropped).`;

/** One block per vault; the vault name heads the block only in a composite scope. */
const blocks = <T>(results: readonly { vault: string; result: T }[], text: (r: T) => string) =>
  results.length === 1
    ? text(results[0]?.result as T)
    : results.map(({ vault, result }) => `[${vault}]\n${text(result)}`).join('\n\n');

const diagnosisText = (diagnosis: Diagnosis, composite: boolean): string =>
  diagnosis.findings.length === 0
    ? 'No problems found.'
    : diagnosis.findings
        .map((f) => `${f.severity}: ${composite ? `[${f.vault}] ` : ''}${f.message}`)
        .join('\n');

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
          inScope(
            ctx,
            perVault(ctx.deps, (idx, vault) => rebuildIndex(ctx.deps, vault, idx)),
          ),
          (results) => blocks(results, rebuildText),
          (results) => ({ vaults: results.map(({ vault, result }) => ({ vault, ...result })) }),
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
          inScope(
            ctx,
            perVault(ctx.deps, (idx, vault) => indexStatus(ctx.deps, vault, idx)),
          ),
          (results) => blocks(results, statusText),
          (results) => ({ vaults: results.map(({ vault, result }) => ({ vault, ...result })) }),
        ),
      );
    });

  program
    .command('doctor')
    .description('check the scope: unavailable vaults, duplicate ids, dangling references')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      const state = { healthy: true };
      const code = await emit(
        ctx,
        inScope(ctx, async (scope) => {
          const result = await diagnose(ctx.deps, scope);
          if (!result.ok) return result;
          state.healthy = result.value.ok;
          return ok({ composite: isComposite(scope), ...result.value });
        }),
        ({ composite, ...diagnosis }) => diagnosisText(diagnosis, composite),
        ({ composite: _composite, ...diagnosis }) => diagnosis,
      );
      exit(code === 0 && !state.healthy ? EXIT_CODES.VALIDATION : code);
    });

  const scope = program.command('scope').description('inspect named scopes and the current one');
  scope
    .command('list')
    .description('list the named scopes in the user config')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          () => listScopes(ctx.deps),
          (listing) =>
            listing.scopes.length === 0
              ? `No scopes defined in ${listing.configPath}.`
              : table(listing.scopes.map((s) => [s.name, s.vaults.join(', ')])),
        ),
      );
    });
  scope
    .command('show')
    .description('show the vaults of a named scope, or of the current scope')
    .argument('[name]', 'scope name (default: the current scope)')
    .action(async (name: string | undefined, _opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          async () => {
            const loaded =
              name === undefined
                ? await currentScope(ctx)
                : await loadScope(ctx.deps, { cwd: ctx.cwd, scope: name });
            if (!loaded.ok) return loaded;
            return ok(describeScope(loaded.value));
          },
          (description) =>
            [
              `scope: ${description.name ?? '(ad hoc)'}`,
              ...description.members.map((m) =>
                m.available
                  ? `  ${m.name ?? ''}  ${m.root}  available`
                  : `  -  ${m.root}  unavailable: ${m.reason ?? ''}`,
              ),
            ].join('\n'),
        ),
      );
    });
};
