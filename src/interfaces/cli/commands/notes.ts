import type { Command } from 'commander';
import { adoptNote, type AdoptedNote } from '../../../application/notes/adopt-note.js';
import { createNote } from '../../../application/notes/create-note.js';
import { listNotes } from '../../../application/notes/list-notes.js';
import { showNote } from '../../../application/notes/show-note.js';
import type { PluginRegistry } from '../../../application/plugin/plugin.js';
import {
  describeFields,
  type FieldDescription,
} from '../../../application/plugin/validate-fields.js';
import { extractFields } from '../../../domain/note/fields.js';
import { isNote, type NoteEntry } from '../../../domain/note/note.js';
import { ok } from '../../../domain/result.js';
import { isComposite, resolveWriteTarget, type Scope } from '../../../domain/scope/scope.js';
import { absoluteNotePath } from '../../../domain/vault/paths.js';
import type { Exit } from '../commands.js';
import {
  contextFor,
  inScope,
  inScopeWithPlugins,
  type CliContext,
  type CliIo,
} from '../context.js';
import { emit, noteToJson, summaryRow, table } from '../output.js';
import { parseVar } from './mutations.js';

/** Declared fields of a note whose type an enabled plugin owns; `null` for every other note. */
const fieldsOf = (registry: PluginRegistry, entry: NoteEntry): FieldDescription | null => {
  if (!isNote(entry) || entry.type === undefined) return null;
  const owner = registry.ownerOf(entry.type);
  return owner ? describeFields(owner.fields, extractFields(entry.frontmatter)) : null;
};

const fieldLines = (fields: FieldDescription): string[] => {
  const lines = ['fields:'];
  for (const f of fields.declared) {
    const value =
      f.value === undefined ? '-' : typeof f.value === 'string' ? f.value : JSON.stringify(f.value);
    lines.push(`  ${f.name}: ${value} (${f.type})${f.issue ? `  ! ${f.issue.message}` : ''}`);
  }
  if (fields.undeclared.length) lines.push(`  undeclared: ${fields.undeclared.join(', ')}`);
  return lines;
};

const showText = (
  vault: string,
  entry: NoteEntry,
  fields: FieldDescription | null,
  raw: boolean,
  composite: boolean,
): string => {
  if (raw) return entry.source;
  const lines = [`title: ${entry.title}`, `path: ${entry.path}`];
  if (composite) lines.push(`vault: ${vault}`);
  if (isNote(entry)) {
    lines.unshift(`id: ${entry.id}`);
    if (entry.type !== undefined) lines.push(`type: ${entry.type}`);
    if (entry.aliases.length) lines.push(`aliases: ${entry.aliases.join(', ')}`);
    if (entry.dates.length) lines.push(`dates: ${entry.dates.join(', ')}`);
    if (entry.tags.length) lines.push(`tags: ${entry.tags.join(', ')}`);
    lines.push(`visibility: ${entry.visibility}`);
  }
  if (fields) lines.push(...fieldLines(fields));
  if (entry.references.length) {
    lines.push(`references: ${entry.references.map((r) => r.target).join(', ')}`);
  }
  return `${lines.join('\n')}\n\n${entry.source.slice(entry.body.start)}`;
};

/** Writes need one vault: the scope's only one, `--in`, or the one containing the cwd. */
const writeTarget = (ctx: CliContext, scope: Scope, inVault: string | undefined) =>
  resolveWriteTarget(scope, { ...(inVault !== undefined && { vault: inVault }), cwd: ctx.cwd });

const IN_HELP = 'vault (name or path) to write in when the scope has several';

export const registerNoteCommands = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('create')
    .description('create a note from a template')
    .requiredOption('--title <title>', 'note title')
    .option(
      '--template <name>',
      'template under .notes/templates/, or a plugin one as <plugin>/<name> (default: default)',
    )
    .option('--var <name=value>', 'template variable (repeatable)', parseVar)
    .option('--path <path>', 'output path relative to the vault root')
    .option('--in <vault>', IN_HELP)
    .action(
      async (
        opts: {
          title: string;
          template?: string;
          var?: Record<string, string>;
          path?: string;
          in?: string;
        },
        cmd: Command,
      ) => {
        const ctx = contextFor(io, cmd);
        exit(
          await emit(
            ctx,
            inScopeWithPlugins(ctx, async (scope, registry) => {
              const vault = writeTarget(ctx, scope, opts.in);
              if (!vault.ok) return vault;
              const created = await createNote(
                ctx.deps,
                vault.value,
                {
                  title: opts.title,
                  ...(opts.template !== undefined && { template: opts.template }),
                  ...(opts.var !== undefined && { variables: opts.var }),
                  ...(opts.path !== undefined && { path: opts.path }),
                },
                registry.templates(),
              );
              if (!created.ok) return created;
              return ok({ vault: vault.value.config.name, note: created.value });
            }),
            ({ note }) => `Created ${note.id} at ${note.path}`,
            ({ vault, note }) => ({ vault, ...noteToJson(note) }),
          ),
        );
      },
    );

  program
    .command('list')
    .description('list notes in the scope')
    .option('--unidentified', 'only files without an id')
    .option('--tag <tag>', 'only notes carrying this tag')
    .option('--date <date>', 'only notes bound to a date: YYYY-MM-DD or FROM..TO')
    .action(async (opts: { unidentified?: boolean; tag?: string; date?: string }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inScope(ctx, async (scope) => {
            const entries = await listNotes(ctx.deps, scope, {
              ...(opts.unidentified !== undefined && { unidentified: opts.unidentified }),
              ...(opts.tag !== undefined && { tag: opts.tag }),
              ...(opts.date !== undefined && { date: opts.date }),
            });
            if (!entries.ok) return entries;
            return ok({ composite: isComposite(scope), entries: entries.value });
          }),
          ({ composite, entries }) =>
            entries.length === 0
              ? 'No notes found.'
              : table(
                  entries.map((e) => (composite ? [e.vault, ...summaryRow(e)] : summaryRow(e))),
                ),
          ({ entries }) => ({ notes: entries }),
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
          inScopeWithPlugins(ctx, async (scope, registry) => {
            const located = await showNote(ctx.deps, scope, query);
            if (!located.ok) return located;
            return ok({
              composite: isComposite(scope),
              fields: fieldsOf(registry, located.value.note),
              ...located.value,
            });
          }),
          ({ composite, fields, vault, note }) =>
            showText(vault.config.name, note, fields, opts.raw ?? false, composite),
          ({ fields, vault, note }) => ({
            vault: vault.config.name,
            ...noteToJson(note),
            ...(fields && { declaredFields: fields }),
          }),
        ),
      );
    });

  program
    .command('edit')
    .description('open a note in the external editor (vault `editor:`, else $VISUAL/$EDITOR)')
    .argument('<query>', 'note id, title or alias')
    .action(async (query: string, _opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inScope(ctx, async (scope) => {
            const located = await showNote(ctx.deps, scope, query);
            if (!located.ok) return located;
            const { vault, note } = located.value;
            const command = vault.config.editor;
            const edited = await io.editor.open(
              absoluteNotePath(vault.root, note.path),
              command === undefined ? {} : { command },
            );
            if (!edited.ok) return edited;
            return ok({ vault: vault.config.name, path: note.path });
          }),
          ({ path }) => `Edited ${path}`,
        ),
      );
    });

  program
    .command('adopt')
    .description('assign an id to Markdown files that have none')
    .argument('<paths...>', 'vault-relative file paths')
    .option('--type <type>', 'note type for {type} identity formats (frontmatter "type" wins)')
    .option('--in <vault>', IN_HELP)
    .action(async (paths: string[], opts: { type?: string; in?: string }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inScope(ctx, async (scope) => {
            const vault = writeTarget(ctx, scope, opts.in);
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
            return ok({ vault: vault.value.config.name, adopted });
          }),
          ({ adopted }) => adopted.map((a) => `Adopted ${a.path} -> ${a.id}`).join('\n'),
        ),
      );
    });
};
