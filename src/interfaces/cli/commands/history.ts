import type { Command } from 'commander';
import {
  diffRevisions,
  listRevisions,
  type NoteHistory,
  type RevisionDiff,
} from '../../../application/history/history.js';
import { saveNote, type SavedNote } from '../../../application/history/save-note.js';
import { isNote } from '../../../domain/note/note.js';
import {
  abbreviate,
  type Revision,
  type RevisionStatus,
} from '../../../domain/revision/revision.js';
import type { Exit } from '../commands.js';
import { contextFor, inScope, type CliIo } from '../context.js';
import { emit, table } from '../output.js';

/** `2026-10-27 13:22` from an ISO timestamp, in the zone the revision was recorded in. */
export const revisionDate = (revision: Revision): string =>
  revision.timestamp.slice(0, 16).replace('T', ' ');

const revisionRow = (revision: Revision): string[] => [
  abbreviate(revision.id),
  revisionDate(revision),
  revision.author ?? '-',
  revision.summary,
];

const statusText = (path: string, status: RevisionStatus): string => {
  switch (status.kind) {
    case 'unversioned':
      return `${path} is not under version control`;
    case 'unrecorded':
      return `No revisions recorded for ${path}`;
    case 'clean':
      return `${path} matches its last revision (${abbreviate(status.last.id)})`;
    case 'modified':
      return `${path} has changed since its last revision (${abbreviate(status.last.id)})`;
  }
};

const historyText = (history: NoteHistory): string => {
  const path = history.entry.path;
  if (history.revisions.length === 0) return statusText(path, history.status);
  const rows = table(history.revisions.map(revisionRow));
  return history.status.kind === 'modified'
    ? `${rows}\n(${statusText(path, history.status)})`
    : rows;
};

const entryJson = (found: { entry: NoteHistory['entry']; vault: NoteHistory['vault'] }) => ({
  vault: found.vault.config.name,
  path: found.entry.path,
  ...(isNote(found.entry) && { id: found.entry.id }),
});

const endText = (end: Revision | 'working'): string =>
  end === 'working' ? 'the working file' : abbreviate(end.id);

const diffText = (diff: RevisionDiff): string =>
  diff.patch === ''
    ? `No differences between ${endText(diff.from)} and ${endText(diff.to)} for ${diff.entry.path}`
    : diff.patch.trimEnd();

const saveText = (saved: SavedNote): string => {
  const path = saved.entry.path;
  switch (saved.outcome.kind) {
    case 'saved':
      return `Saved ${path} as revision ${abbreviate(saved.outcome.revision.id)}: ${saved.outcome.revision.summary}`;
    case 'nothing-to-save':
      return `Nothing to save: ${statusText(path, { kind: 'clean', last: saved.outcome.last })}`;
    case 'not-under-version-control':
      return `Nothing saved: ${path} is not under version control`;
  }
};

export const registerHistoryCommands = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('history')
    .description('list the recorded revisions of a note, newest first')
    .argument('<query>', 'note id, title or alias')
    .action(async (query: string, _opts: unknown, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inScope(ctx, (scope) => listRevisions(ctx.deps, scope, { query })),
          historyText,
          (history) => ({
            ...entryJson(history),
            status: history.status,
            revisions: history.revisions,
          }),
        ),
      );
    });

  program
    .command('diff')
    .description('compare revisions of a note (default: last revision against the working file)')
    .argument('<query>', 'note id, title or alias')
    .option('--from <rev>', 'older revision (id or prefix); default: the one before --to')
    .option('--to <rev>', 'newer revision (id or prefix) or "working"', 'working')
    .action(async (query: string, opts: { from?: string; to: string }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inScope(ctx, (scope) =>
            diffRevisions(
              ctx.deps,
              scope,
              { query },
              {
                ...(opts.from !== undefined && { from: opts.from }),
                to: opts.to,
              },
            ),
          ),
          diffText,
          (diff) => ({ ...entryJson(diff), from: diff.from, to: diff.to, patch: diff.patch }),
        ),
      );
    });

  program
    .command('save')
    .description('record the current file as a new revision of the note')
    .argument('<query>', 'note id, title or alias')
    .option('-m, --message <message>', 'revision message (default: "Save <title>")')
    .action(async (query: string, opts: { message?: string }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      exit(
        await emit(
          ctx,
          inScope(ctx, (scope) =>
            saveNote(
              ctx.deps,
              scope,
              { query },
              {
                ...(opts.message !== undefined && { message: opts.message }),
              },
            ),
          ),
          saveText,
          (saved) => ({
            ...entryJson(saved),
            status: saved.outcome.kind,
            ...(saved.outcome.kind === 'saved' && { revision: saved.outcome.revision }),
            ...(saved.outcome.kind === 'nothing-to-save' && { last: saved.outcome.last }),
          }),
        ),
      );
    });
};
