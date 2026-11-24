import type { ReleaseHead, ReleaseProvider } from '../../application/ports.js';
import { appError, conflict, unavailable, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import { output, runGit, type GitOptions, type GitOutput } from './run-git.js';

/*
 * Release tags through the user's own `git` binary, run from the vault's directory so a vault
 * nested below the repository root tags the repository that holds it. The tag is annotated
 * (`git tag -a`), so it carries who cut the release and when; the push names the tag's ref
 * alone, so no branch moves on the remote.
 */

const NOT_A_REPOSITORY = /not a git repository/i;

export const createGitReleaseProvider = (options: GitOptions = {}): ReleaseProvider => {
  const readEnv: NodeJS.ProcessEnv = { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: '0' };
  const writeEnv: NodeJS.ProcessEnv = { ...process.env, ...options.env };

  const failed = (what: string, run: GitOutput): AppError =>
    appError('INTERNAL', `${what} (git exited ${String(run.code)}): ${output(run)}`, {
      code: run.code,
      output: output(run),
    });

  return {
    async head(root): Promise<Result<ReleaseHead | null, AppError>> {
      const inside = await runGit(root, ['rev-parse', '--show-toplevel'], readEnv);
      if (!inside.ok) return inside;
      if (inside.value.code !== 0) {
        return NOT_A_REPOSITORY.test(inside.value.stderr)
          ? ok(null)
          : err(unavailable(`git rev-parse failed in ${root}: ${output(inside.value)}`));
      }
      const head = await runGit(
        root,
        ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
        readEnv,
      );
      if (!head.ok) return head;
      if (head.value.code !== 0) {
        return err(
          unavailable(`The repository holding ${root} has no commit to release`, { root }),
        );
      }
      // Scoped to the vault: unrelated work elsewhere in the repository is not this release's.
      const status = await runGit(root, ['status', '--porcelain', '--', '.'], readEnv);
      if (!status.ok) return status;
      if (status.value.code !== 0) {
        return err(unavailable(`git status failed in ${root}: ${output(status.value)}`));
      }
      return ok({
        commit: head.value.stdout.trim(),
        uncommitted: status.value.stdout.trim() !== '',
      });
    },

    async remotes(root) {
      const run = await runGit(root, ['remote'], readEnv);
      if (!run.ok) return run;
      if (run.value.code !== 0) {
        return err(unavailable(`git remote failed in ${root}: ${output(run.value)}`));
      }
      return ok(run.value.stdout.split('\n').filter((name) => name !== ''));
    },

    async tag(root, name, message) {
      const run = await runGit(root, ['tag', '-a', name, '-m', message, 'HEAD'], writeEnv);
      if (!run.ok) return run;
      if (run.value.code === 0) return ok(undefined);
      return err(
        run.value.stderr.includes('already exists')
          ? conflict(`Tag ${name} already exists`, { tag: name })
          : failed(`Tag ${name} was not created`, run.value),
      );
    },

    async push(root, remote, tag) {
      const ref = `refs/tags/${tag}`;
      const run = await runGit(root, ['push', remote, `${ref}:${ref}`], writeEnv);
      if (!run.ok) return run;
      return run.value.code === 0
        ? ok(undefined)
        : err(failed(`Tag ${tag} was not pushed to ${remote}`, run.value));
    },
  };
};
