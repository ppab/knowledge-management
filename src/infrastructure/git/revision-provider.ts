import { relative, resolve } from 'node:path';
import type { RevisionProvider } from '../../application/ports.js';
import { appError, notFound, unavailable, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import { abbreviate, type Revision, type RevisionStatus } from '../../domain/revision/revision.js';
import { output, runGit, type GitOptions } from './run-git.js';

/*
 * Revisions through the user's own `git` binary (docs/architecture.md A4): one file at a time,
 * `log --follow` for history across renames, and `add -- <path> && commit -- <path>` so a
 * save records exactly one note whatever else is staged. Every command runs from the
 * repository's top level with the file's repository-relative path, so a vault nested below the
 * repository root behaves like one at the root. Nothing here reads or writes the repository
 * directly; the user's git, hooks and configuration stay in charge.
 */

export type { GitOptions } from './run-git.js';

const FORMAT = '%x01%H%x00%aI%x00%an%x00%s';

/** Parses `--format=FORMAT --name-status` output: one chunk per revision, newest first. */
const parseLog = (text: string, fallbackPath: string): Revision[] => {
  const revisions: Revision[] = [];
  for (const chunk of text.split('\u0001')) {
    if (chunk.trim() === '') continue;
    const newline = chunk.indexOf('\n');
    const header = newline < 0 ? chunk : chunk.slice(0, newline);
    const [id, timestamp, author, summary] = header.split('\u0000');
    if (id === undefined || timestamp === undefined) continue;
    let path = fallbackPath;
    if (newline >= 0) {
      for (const line of chunk.slice(newline + 1).split('\n')) {
        const fields = line.split('\t');
        const last = fields[fields.length - 1];
        if (fields.length >= 2 && last !== undefined && last !== '') path = last;
      }
    }
    revisions.push({
      id,
      timestamp,
      summary: summary ?? '',
      ...(author !== undefined && author !== '' && { author }),
      path,
    });
    // Later revisions of a renamed file were recorded under the newer name.
    fallbackPath = path;
  }
  return revisions;
};

const NO_COMMITS = /does not have any commits yet|bad default revision|unknown revision/;

export const createGitRevisionProvider = (options: GitOptions = {}): RevisionProvider => {
  const readEnv: NodeJS.ProcessEnv = { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: '0' };
  const writeEnv: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  const topLevels = new Map<string, string>();

  /** The repository holding `root`, or `null` when there is none; positive answers are cached. */
  const topLevel = async (root: string): Promise<Result<string | null, AppError>> => {
    const cached = topLevels.get(root);
    if (cached !== undefined) return ok(cached);
    const run = await runGit(root, ['rev-parse', '--show-toplevel'], readEnv);
    if (!run.ok) return run;
    if (run.value.code !== 0) {
      return /not a git repository/i.test(run.value.stderr)
        ? ok(null)
        : err(unavailable(`git rev-parse failed in ${root}: ${output(run.value)}`));
    }
    const top = run.value.stdout.trim();
    topLevels.set(root, top);
    return ok(top);
  };

  const repoPath = (top: string, root: string, path: string): string =>
    relative(top, resolve(root, path)).replace(/\\/g, '/');

  const log = async (
    top: string,
    file: string,
    limit?: number,
  ): Promise<Result<Revision[], AppError>> => {
    const run = await runGit(
      top,
      [
        'log',
        '--follow',
        '--name-status',
        `--format=${FORMAT}`,
        ...(limit === undefined ? [] : [`-${String(limit)}`]),
        '--',
        `:(literal)${file}`,
      ],
      readEnv,
    );
    if (!run.ok) return run;
    if (run.value.code !== 0) {
      return NO_COMMITS.test(run.value.stderr)
        ? ok([])
        : err(unavailable(`git log failed for ${file}: ${output(run.value)}`));
    }
    return ok(parseLog(run.value.stdout, file));
  };

  const notVersioned = (root: string): AppError =>
    unavailable(`${root} is not under version control`, { root });

  return {
    async status(root, path): Promise<Result<RevisionStatus, AppError>> {
      const top = await topLevel(root);
      if (!top.ok) return top;
      if (top.value === null) return ok({ kind: 'unversioned' });
      const file = repoPath(top.value, root, path);
      const last = await log(top.value, file, 1);
      if (!last.ok) return last;
      const [revision] = last.value;
      if (!revision) return ok({ kind: 'unrecorded' });
      // The last revision may have removed the file; then the working file is a new one.
      const inHead = await runGit(top.value, ['cat-file', '-e', `HEAD:${file}`], readEnv);
      if (!inHead.ok) return inHead;
      if (inHead.value.code !== 0) return ok({ kind: 'unrecorded' });
      const diff = await runGit(
        top.value,
        ['diff', '--quiet', 'HEAD', '--', `:(literal)${file}`],
        readEnv,
      );
      if (!diff.ok) return diff;
      if (diff.value.code === 0) return ok({ kind: 'clean', last: revision });
      if (diff.value.code === 1) return ok({ kind: 'modified', last: revision });
      return err(unavailable(`git diff failed for ${path}: ${output(diff.value)}`));
    },

    async list(root, path) {
      const top = await topLevel(root);
      if (!top.ok) return top;
      if (top.value === null) return ok([]);
      return log(top.value, repoPath(top.value, root, path));
    },

    async read(root, revision) {
      const top = await topLevel(root);
      if (!top.ok) return top;
      if (top.value === null) return err(notVersioned(root));
      const run = await runGit(top.value, ['show', `${revision.id}:${revision.path}`], readEnv);
      if (!run.ok) return run;
      if (run.value.code === 0) return ok(run.value.stdout);
      return err(
        notFound(`No content of ${revision.path} at revision ${abbreviate(revision.id)}`, {
          revision: revision.id,
          path: revision.path,
          output: output(run.value),
        }),
      );
    },

    async record(root, path, message) {
      const top = await topLevel(root);
      if (!top.ok) return top;
      if (top.value === null) return err(notVersioned(root));
      const file = repoPath(top.value, root, path);
      const added = await runGit(top.value, ['add', '--', `:(literal)${file}`], writeEnv);
      if (!added.ok) return added;
      if (added.value.code !== 0) {
        return err(
          appError('INTERNAL', `Cannot stage ${path}: ${output(added.value)}`, {
            path,
            output: output(added.value),
          }),
        );
      }
      const committed = await runGit(
        top.value,
        ['commit', '-m', message, '--', `:(literal)${file}`],
        writeEnv,
      );
      if (!committed.ok) return committed;
      if (committed.value.code !== 0) {
        const text = output(committed.value);
        return err(
          appError(
            'INTERNAL',
            `Revision of ${path} was not recorded (git commit exited ${String(committed.value.code)})${text === '' ? '' : `:\n${text}`}`,
            { path, code: committed.value.code, output: text },
          ),
        );
      }
      const recorded = await log(top.value, file, 1);
      if (!recorded.ok) return recorded;
      const [revision] = recorded.value;
      return revision
        ? ok(revision)
        : err(appError('INTERNAL', `Recorded ${path} but cannot read the revision back`));
    },

    // A bare `git push`: the user's upstream and `push.default` decide where the branch goes.
    async push(root) {
      const top = await topLevel(root);
      if (!top.ok) return top;
      if (top.value === null) return err(notVersioned(root));
      const pushed = await runGit(top.value, ['push'], writeEnv);
      if (!pushed.ok) return pushed;
      if (pushed.value.code === 0) return ok(undefined);
      const text = output(pushed.value);
      return err(
        appError('INTERNAL', `git push exited ${String(pushed.value.code)}: ${text}`, {
          code: pushed.value.code,
          output: text,
        }),
      );
    },
  };
};
