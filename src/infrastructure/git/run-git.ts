import { execFile } from 'node:child_process';
import { unavailable, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';

/*
 * The one place that spawns the user's own `git` binary. A non-zero exit is an answer, not an
 * error: callers read `code` and decide. Only a git that cannot be run at all is `UNAVAILABLE`.
 */

export interface GitOptions {
  /** Extra environment for the spawned git (tests pin an identity and isolate the config). */
  readonly env?: Readonly<Record<string, string>>;
}

export interface GitOutput {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const MAX_OUTPUT = 64 * 1024 * 1024;

export const runGit = (
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<Result<GitOutput, AppError>> =>
  new Promise((resolveRun) => {
    execFile(
      'git',
      [...args],
      { cwd, env, maxBuffer: MAX_OUTPUT, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error && !('code' in error && typeof error.code === 'number')) {
          const cause = error as NodeJS.ErrnoException;
          resolveRun(
            err(
              cause.code === 'ENOENT'
                ? unavailable('git was not found on PATH; revisions need it')
                : unavailable(`Cannot run git: ${cause.message}`),
            ),
          );
          return;
        }
        resolveRun(ok({ code: error ? Number(error.code) : 0, stdout, stderr }));
      },
    );
  });

export const output = (result: GitOutput): string => `${result.stdout}${result.stderr}`.trim();
