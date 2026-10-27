import { InvalidArgumentError, type Command } from 'commander';
import {
  backlinks,
  listReferences,
  type OutgoingReference,
} from '../../../application/references/references.js';
import { searchNotes } from '../../../application/search/search-notes.js';
import type { Exit } from '../commands.js';
import { contextFor, inVault, type CliIo } from '../context.js';
import { emit, summaryRow, table } from '../output.js';

const parseLimit = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('expected a positive integer');
  return n;
};

const referenceText = (ref: OutgoingReference): string => {
  const shown = ref.label === undefined ? `[[${ref.target}]]` : `[[${ref.target}|${ref.label}]]`;
  switch (ref.resolution.state) {
    case 'resolved':
      return `${shown} -> ${ref.resolution.note.title} (${ref.resolution.note.path})`;
    case 'ambiguous':
      return `${shown} -> ambiguous: ${ref.resolution.paths.join(', ')}`;
    case 'unresolved':
      return `${shown} -> unresolved`;
  }
};

export const registerQueryCommands = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('search')
    .description('full-text search over titles, aliases and bodies')
    .argument('<query...>', 'words to search for; a trailing * matches prefixes')
    .option('--limit <n>', 'maximum number of results (default: 20)', parseLimit)
    .action(async (words: string[], opts: { limit?: number }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(ctx, (vault) =>
            searchNotes(ctx.deps, vault, words.join(' '), {
              ...(opts.limit !== undefined && { limit: opts.limit }),
            }),
          ),
          (hits) => {
            if (hits.length === 0) return 'No matches.';
            const rows = table(hits.map((h) => summaryRow(h.entry))).split('\n');
            return hits.map((h, i) => `${rows[i] ?? ''}\n    ${h.snippet}`).join('\n');
          },
          (hits) => ({ hits: hits.map(({ entry, ...rest }) => ({ ...entry, ...rest })) }),
        ),
      );
    });

  program
    .command('backlinks')
    .description('list notes that reference the given note')
    .argument('<query>', 'note id, title or alias')
    .action(async (query: string, _opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(ctx, (vault) => backlinks(ctx.deps, vault, query)),
          (listing) =>
            listing.backlinks.length === 0
              ? `No backlinks to ${listing.target.id}.`
              : table(
                  listing.backlinks.map((b) => [
                    ...summaryRow(b.source),
                    `@${String(b.range.start)}`,
                  ]),
                ),
          (listing) => ({
            target: listing.target,
            backlinks: listing.backlinks.map(({ source, ...rest }) => ({ ...rest, source })),
          }),
        ),
      );
    });

  const reference = program.command('reference').description('work with [[references]]');
  reference
    .command('list')
    .description('list the references a note makes and where each leads')
    .argument('<query>', 'note id, title or alias')
    .action(async (query: string, _opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(ctx, (vault) => listReferences(ctx.deps, vault, query)),
          (listing) =>
            listing.references.length === 0
              ? `${listing.source.id} makes no references.`
              : listing.references.map(referenceText).join('\n'),
        ),
      );
    });
};
