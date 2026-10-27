import { InvalidArgumentError, type Command } from 'commander';
import {
  backlinks,
  listReferences,
  type OutgoingReference,
} from '../../../application/references/references.js';
import { searchNotes } from '../../../application/search/search-notes.js';
import { ok } from '../../../domain/result.js';
import { isComposite } from '../../../domain/scope/scope.js';
import type { Exit } from '../commands.js';
import { contextFor, inScope, type CliIo } from '../context.js';
import { emit, summaryRow, table } from '../output.js';

const parseLimit = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('expected a positive integer');
  return n;
};

const referenceText = (ref: OutgoingReference, composite: boolean): string => {
  const shown = ref.label === undefined ? `[[${ref.target}]]` : `[[${ref.target}|${ref.label}]]`;
  const r = ref.resolution;
  switch (r.state) {
    case 'resolved':
      return `${shown} -> ${r.note.title} (${composite ? `${r.vault}:` : ''}${r.note.path})`;
    case 'ambiguous':
      return `${shown} -> ambiguous: ${r.candidates.map((c) => `${c.vault}:${c.path}`).join(', ')}`;
    case 'unavailable':
      return `${shown} -> not found; unavailable: ${r.vaults.join(', ')}`;
    case 'unresolved':
      return `${shown} -> unresolved`;
  }
};

/** Registers the read-side commands; returns the `reference` group so `add` can join it. */
export const registerQueryCommands = (program: Command, io: CliIo, exit: Exit): Command => {
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
          inScope(ctx, async (scope) => {
            const hits = await searchNotes(ctx.deps, scope, words.join(' '), {
              ...(opts.limit !== undefined && { limit: opts.limit }),
            });
            if (!hits.ok) return hits;
            return ok({ composite: isComposite(scope), hits: hits.value });
          }),
          ({ composite, hits }) => {
            if (hits.length === 0) return 'No matches.';
            const rows = table(
              hits.map((h) =>
                composite ? [h.vault, ...summaryRow(h.entry)] : summaryRow(h.entry),
              ),
            ).split('\n');
            return hits.map((h, i) => `${rows[i] ?? ''}\n    ${h.snippet}`).join('\n');
          },
          ({ hits }) => ({ hits: hits.map(({ entry, ...rest }) => ({ ...entry, ...rest })) }),
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
          inScope(ctx, async (scope) => {
            const listing = await backlinks(ctx.deps, scope, query);
            if (!listing.ok) return listing;
            return ok({ composite: isComposite(scope), ...listing.value });
          }),
          (listing) =>
            listing.backlinks.length === 0
              ? `No backlinks to ${listing.target.id}.`
              : table(
                  listing.backlinks.map((b) => [
                    ...(listing.composite ? [b.vault] : []),
                    ...summaryRow(b.source),
                    `@${String(b.range.start)}`,
                  ]),
                ),
          ({ composite: _composite, ...listing }) => listing,
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
          inScope(ctx, async (scope) => {
            const listing = await listReferences(ctx.deps, scope, query);
            if (!listing.ok) return listing;
            return ok({ composite: isComposite(scope), ...listing.value });
          }),
          (listing) =>
            listing.references.length === 0
              ? `${listing.source.id} makes no references.`
              : listing.references.map((r) => referenceText(r, listing.composite)).join('\n'),
          ({ composite: _composite, ...listing }) => listing,
        ),
      );
    });
  return reference;
};
