import { InvalidArgumentError, type Command } from 'commander';
import { adoptNote, type AdoptedNote } from '../../application/notes/adopt-note.js';
import { createNote } from '../../application/notes/create-note.js';
import { listNotes } from '../../application/notes/list-notes.js';
import { showNote } from '../../application/notes/show-note.js';
import { initVault } from '../../application/vault/vault.js';
import { usage, type AppError } from '../../domain/errors.js';
import type { IdentityConfig } from '../../domain/identity/identity.js';
import { isNote, type NoteEntry } from '../../domain/note/note.js';
import { andThen, err, ok, type Result } from '../../domain/result.js';
import { contextFor, currentVault, type CliIo } from './context.js';
import { emit, noteToJson, table } from './output.js';

type Exit = (code: number) => void;

const parseVar = (value: string, previous: Record<string, string> = {}) => {
  const eq = value.indexOf('=');
  if (eq <= 0) throw new InvalidArgumentError('expected name=value');
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
};

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

const entryRow = (entry: NoteEntry): string[] => [
  isNote(entry) ? entry.id : '-',
  entry.title,
  entry.path,
];

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

export const registerCommands = (program: Command, io: CliIo, exit: Exit): void => {
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
            async () => {
              const vault = await currentVault(ctx);
              if (!vault.ok) return vault;
              return createNote(ctx.deps, vault.value, {
                title: opts.title,
                ...(opts.template !== undefined && { template: opts.template }),
                ...(opts.var !== undefined && { variables: opts.var }),
                ...(opts.path !== undefined && { path: opts.path }),
              });
            },
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
    .action(async (opts: { unidentified?: boolean }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          async () => {
            const vault = await currentVault(ctx);
            if (!vault.ok) return vault;
            return andThen(await listNotes(ctx.deps, vault.value), (entries) =>
              ok(opts.unidentified ? entries.filter((e) => !isNote(e)) : entries),
            );
          },
          (entries) => (entries.length === 0 ? 'No notes found.' : table(entries.map(entryRow))),
          (entries) => ({ notes: entries.map(noteToJson) }),
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
          async () => {
            const vault = await currentVault(ctx);
            if (!vault.ok) return vault;
            return showNote(ctx.deps, vault.value, query);
          },
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
          async () => {
            const vault = await currentVault(ctx);
            if (!vault.ok) return vault;
            const adopted: AdoptedNote[] = [];
            for (const path of paths) {
              const result = await adoptNote(ctx.deps, vault.value, {
                path,
                ...(opts.type !== undefined && { type: opts.type }),
              });
              if (!result.ok) return result;
              adopted.push(result.value);
            }
            return ok(adopted);
          },
          (adopted) => adopted.map((a) => `Adopted ${a.path} -> ${a.id}`).join('\n'),
          (adopted) => ({ adopted }),
        ),
      );
    });
};
