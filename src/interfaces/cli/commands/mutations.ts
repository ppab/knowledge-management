import { InvalidArgumentError, type Command } from 'commander';
import { bindDate } from '../../../application/calendar/bind-date.js';
import { linkReference } from '../../../application/references/link-reference.js';
import { relabelAll, relabelReferences } from '../../../application/references/relabel.js';
import { insertSnippet } from '../../../application/snippets/insert-snippet.js';
import { usage } from '../../../domain/errors.js';
import { parseInsertionLocation, type InsertionLocation } from '../../../domain/text/insertion.js';
import type { Exit } from '../commands.js';
import { contextFor, inScope, type CliIo } from '../context.js';
import { emit, mutationText, relabelAllText, reportError } from '../output.js';

const parseAt = (value: string): InsertionLocation => {
  const location = parseInsertionLocation(value);
  if (!location.ok) throw new InvalidArgumentError(location.error.message);
  return location.value;
};

export const parseVar = (value: string, previous: Record<string, string> = {}) => {
  const eq = value.indexOf('=');
  if (eq <= 0) throw new InvalidArgumentError('expected name=value');
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
};

const AT_HELP = 'where to insert: end | heading:<text> | references';

/** `link`, `relabel`, `snippet insert` and `bind`: the structured writes, all previewable. */
export const registerMutationCommands = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('link')
    .description('link one entry to another with a [[reference]]')
    .requiredOption('--source <query>', 'entry to edit: id, title or alias')
    .requiredOption('--target <query>', 'entry to point at: id, title or alias')
    .option('--at <location>', `${AT_HELP} (default: end)`, parseAt)
    .option('--label <text>', 'display label, written as [[id|label]]')
    .option('--dry-run', 'print the change as a diff and write nothing')
    .action(
      async (
        opts: {
          source: string;
          target: string;
          at?: InsertionLocation;
          label?: string;
          dryRun?: boolean;
        },
        cmd: Command,
      ) => {
        const ctx = contextFor(io, cmd);
        exit(
          await emit(
            ctx,
            inScope(ctx, (scope) =>
              linkReference(ctx.deps, scope, {
                source: opts.source,
                target: opts.target,
                ...(opts.at !== undefined && { at: opts.at }),
                ...(opts.label !== undefined && { label: opts.label }),
                ...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
              }),
            ),
            mutationText,
          ),
        );
      },
    );

  program
    .command('relabel')
    .description("refresh standalone [[links]] to show each target's current title")
    .argument('[query]', 'entry to relabel: id, title or alias (omit with --all)')
    .option('--all', 'relabel every entry in the scope')
    .option('--dry-run', 'print the change as a diff and write nothing')
    .action(
      async (
        query: string | undefined,
        opts: { all?: boolean; dryRun?: boolean },
        cmd: Command,
      ) => {
        const ctx = contextFor(io, cmd);
        if (opts.all) {
          exit(
            await emit(
              ctx,
              inScope(ctx, (scope) =>
                relabelAll(ctx.deps, scope, { ...(opts.dryRun !== undefined && { dryRun: true }) }),
              ),
              relabelAllText,
            ),
          );
          return;
        }
        if (query === undefined) {
          exit(reportError(ctx, usage('Provide an entry query, or --all to relabel the scope')));
          return;
        }
        exit(
          await emit(
            ctx,
            inScope(ctx, (scope) =>
              relabelReferences(ctx.deps, scope, {
                source: query,
                ...(opts.dryRun !== undefined && { dryRun: true }),
              }),
            ),
            mutationText,
          ),
        );
      },
    );

  const snippet = program.command('snippet').description('insert reusable fragments');
  snippet
    .command('insert')
    .description('render a snippet from .ofl/snippets/ into a note')
    .argument('<query>', 'note to edit: id, title or alias')
    .requiredOption('--snippet <name>', 'snippet name')
    .option('--at <location>', `${AT_HELP} (default: the snippet's own, else end)`, parseAt)
    .option('--var <name=value>', 'snippet variable (repeatable)', parseVar)
    .option('--dry-run', 'print the change as a diff and write nothing')
    .action(
      async (
        query: string,
        opts: {
          snippet: string;
          at?: InsertionLocation;
          var?: Record<string, string>;
          dryRun?: boolean;
        },
        cmd: Command,
      ) => {
        const ctx = contextFor(io, cmd);
        exit(
          await emit(
            ctx,
            inScope(ctx, (scope) =>
              insertSnippet(ctx.deps, scope, {
                note: query,
                snippet: opts.snippet,
                ...(opts.at !== undefined && { at: opts.at }),
                ...(opts.var !== undefined && { variables: opts.var }),
                ...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
              }),
            ),
            mutationText,
          ),
        );
      },
    );

  program
    .command('bind')
    .description('bind a note to a calendar date (or unbind it)')
    .argument('<query>', 'note to edit: id, title or alias')
    .requiredOption('--date <date>', 'YYYY-MM-DD')
    .option('--remove', 'remove the date instead of adding it')
    .option('--dry-run', 'print the change as a diff and write nothing')
    .action(
      async (
        query: string,
        opts: { date: string; remove?: boolean; dryRun?: boolean },
        cmd: Command,
      ) => {
        const ctx = contextFor(io, cmd);
        exit(
          await emit(
            ctx,
            inScope(ctx, (scope) =>
              bindDate(ctx.deps, scope, {
                note: query,
                date: opts.date,
                ...(opts.remove !== undefined && { remove: opts.remove }),
                ...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
              }),
            ),
            mutationText,
          ),
        );
      },
    );
};
