import type { MutationOutcome } from '../../application/mutations/mutate.js';
import type { RelabelAllResult } from '../../application/references/relabel.js';
import type { AppError, ErrorCode } from '../../domain/errors.js';
import type { NoteEntry } from '../../domain/note/note.js';
import type { EntrySummary } from '../../domain/note/summary.js';
import type { Result } from '../../domain/result.js';
import type { CliContext } from './context.js';

/** Documented in docs/architecture.md §5; agents branch on these. */
export const EXIT_CODES: Readonly<Record<ErrorCode, number>> = {
  INTERNAL: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  AMBIGUOUS: 4,
  CONFLICT: 5,
  VALIDATION: 6,
  UNAVAILABLE: 7,
};

export const reportError = (ctx: CliContext, error: AppError): number => {
  if (ctx.json) {
    ctx.out(JSON.stringify({ error }, null, 2));
  } else {
    ctx.errOut(`error: ${error.message}`);
    if (error.details) ctx.errOut(JSON.stringify(error.details, null, 2));
  }
  return EXIT_CODES[error.code];
};

/**
 * Runs a use case and prints its outcome: JSON when `--json`, otherwise `text`. Returns the
 * process exit code so commands stay free of `process` access.
 */
export const emit = async <T>(
  ctx: CliContext,
  work: () => Promise<Result<T, AppError>>,
  text: (value: T) => string,
  json: (value: T) => unknown = (value) => value,
): Promise<number> => {
  const result = await work();
  if (!result.ok) return reportError(ctx, result.error);
  ctx.out(ctx.json ? JSON.stringify(json(result.value), null, 2) : text(result.value));
  return 0;
};

/** The stable JSON projection of a note; `source` is replaced by the body `content`. */
export const noteToJson = (entry: NoteEntry): Record<string, unknown> => {
  const { source, body, ...rest } = entry;
  return { ...rest, content: source.slice(body.start) };
};

/** Text for a mutation: the diff for dry runs, otherwise what happened to the file. */
export const mutationText = (outcome: MutationOutcome): string => {
  if (outcome.dryRun) return outcome.diff ?? `No change to ${outcome.path}`;
  return outcome.written ? `Updated ${outcome.path}` : `No change to ${outcome.path}`;
};

/** Text for a scope-wide `relabel --all`: the diffs for a dry run, else what changed. */
export const relabelAllText = (result: RelabelAllResult): string => {
  const scanned = `scanned ${String(result.scanned)} note${result.scanned === 1 ? '' : 's'}`;
  if (result.outcomes.length === 0) return `No links needed relabelling (${scanned})`;
  if (result.outcomes.every((o) => o.dryRun)) {
    return result.outcomes.map((o) => o.diff ?? `Would update ${o.path}`).join('\n');
  }
  const updated = result.outcomes.map((o) => `Updated ${o.path}`).join('\n');
  return `${updated}\n(${scanned}, ${String(result.outcomes.length)} changed)`;
};

export const summaryRow = (entry: EntrySummary): string[] => [
  entry.kind === 'note' ? entry.id : '-',
  entry.title,
  entry.path,
];

export const table = (rows: readonly (readonly string[])[]): string => {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
};
