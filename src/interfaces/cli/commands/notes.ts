import { InvalidArgumentError, type Command } from 'commander';
import { adoptNote, type AdoptedNote } from '../../../application/notes/adopt-note.js';
import { createNote } from '../../../application/notes/create-note.js';
import { listNotes } from '../../../application/notes/list-notes.js';
import { showNote } from '../../../application/notes/show-note.js';
import { isNote, type NoteEntry } from '../../../domain/note/note.js';
import { ok } from '../../../domain/result.js';
import type { Exit } from '../commands.js';
import { contextFor, inVault, type CliIo } from '../context.js';
import { emit, noteToJson, summaryRow, table } from '../output.js';

const parseVar = (value: string, previous: Record<string, string> = {}) => {
  const eq = value.indexOf('=');
  if (eq <= 0) throw new InvalidArgumentError('expected name=value');
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
};

const showText = (entry: NoteEntry, raw: boolean): string => {
  if (raw) return entry.source;
  const lines = [`title: ${entry.title}`, `path: ${entry.path}`];
  if (isNote(entry)) {
    lines.unshift(`id: ${entry.id}`);
    if (entry.aliases.length) lines.push(`aliases: ${entry.aliases.join(', ')}`);
    if (entry.dates.length) lines.push(`dates: ${entry.dates.join(', ')}`);
    if (entry.tags.length) lines.push(`tags: ${entry.tags.join(', ')}`);
    lines.push(`visibility: ${entry.visibility}`);
  }
  if (entry.references.length) {
    lines.push(`references: ${entry.references.map((r) => r.target).join(', ')}`);
  }
  return `${lines.join('\n')}\n\n${entry.source.slice(entry.body.start)}`;
};

export const registerNoteCommands = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('create')
    .description('create a note from a template')
    .requiredOption('--title <title>', 'note title')
    .option('--template <name>', 'template under .notes/templates/ (default: default)')
    .option('--var <name=value>', 'template variable (repeatable)', parseVar)
    .option('--path <path>', 'output path relative to the vault root')
    .action(
      async (
        opts: { title: string; template?: string; var?: Record<string, string>; path?: string },
        cmd: Command,
      ) => {
        const ctx = contextFor(io, cmd);
        exit(
          await emit(
            ctx,
            inVault(ctx, (vault) =>
              createNote(ctx.deps, vault, {
                title: opts.title,
                ...(opts.template !== undefined && { template: opts.template }),
                ...(opts.var !== undefined && { variables: opts.var }),
                ...(opts.path !== undefined && { path: opts.path }),
              }),
            ),
            (note) => `Created ${note.id} at ${note.path}`,
            noteToJson,
          ),
        );
      },
    );

  program
    .command('list')
    .description('list notes in the vault')
    .option('--unidentified', 'only files without an id')
    .option('--tag <tag>', 'only notes carrying this tag')
    .option('--date <date>', 'only notes bound to a date: YYYY-MM-DD or FROM..TO')
    .action(async (opts: { unidentified?: boolean; tag?: string; date?: string }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(ctx, (vault) =>
            listNotes(ctx.deps, vault, {
              ...(opts.unidentified !== undefined && { unidentified: opts.unidentified }),
              ...(opts.tag !== undefined && { tag: opts.tag }),
              ...(opts.date !== undefined && { date: opts.date }),
            }),
          ),
          (entries) => (entries.length === 0 ? 'No notes found.' : table(entries.map(summaryRow))),
          (entries) => ({ notes: entries }),
        ),
      );
    });

  program
    .command('show')
    .description('show a note by id, title or alias')
    .argument('<query>', 'note id, title or alias')
    .option('--raw', 'print the file exactly as stored')
    .action(async (query: string, opts: { raw?: boolean }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(ctx, (vault) => showNote(ctx.deps, vault, query)),
          (note) => showText(note, opts.raw ?? false),
          noteToJson,
        ),
      );
    });

  program
    .command('adopt')
    .description('assign an id to Markdown files that have none')
    .argument('<paths...>', 'vault-relative file paths')
    .option('--type <type>', 'note type for {type} identity formats (frontmatter "type" wins)')
    .action(async (paths: string[], opts: { type?: string }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inVault(ctx, async (vault) => {
            const adopted: AdoptedNote[] = [];
            for (const path of paths) {
              const result = await adoptNote(ctx.deps, vault, {
                path,
                ...(opts.type !== undefined && { type: opts.type }),
              });
              if (!result.ok) return result;
              adopted.push(result.value);
            }
            return ok(adopted);
          }),
          (adopted) => adopted.map((a) => `Adopted ${a.path} -> ${a.id}`).join('\n'),
          (adopted) => ({ adopted }),
        ),
      );
    });
};
