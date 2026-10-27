import { spawn } from 'node:child_process';
import { appError, unavailable, usage, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ExternalEditor } from '../../application/ports.js';

/*
 * docs/decisions/0002-editor-handoff.md: the editor gets the terminal through `stdio: inherit`
 * and this adapter knows nothing about the TUI. The command is split on whitespace and never
 * run through a shell, so `editor: "code --wait"` works and `editor: "vim; rm -rf /"` does not.
 */

export const DEFAULT_EDITOR = 'nvim';

/** The vault's `editor:` setting, else `$VISUAL`, else `$EDITOR`, else nvim. */
export const resolveEditorCommand = (
  configured: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string => {
  for (const candidate of [configured, env.VISUAL, env.EDITOR]) {
    if (candidate !== undefined && candidate.trim() !== '') return candidate.trim();
  }
  return DEFAULT_EDITOR;
};

export const createExternalEditor = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExternalEditor => ({
  open(file, options = {}) {
    const [command, ...args] = resolveEditorCommand(options.command, env).split(/\s+/);
    if (command === undefined || command === '') {
      return Promise.resolve(err(usage('No editor configured')));
    }
    return new Promise<Result<void, AppError>>((resolve) => {
      const child = spawn(command, [...args, file], { stdio: 'inherit' });
      child.once('error', (cause: NodeJS.ErrnoException) => {
        resolve(
          err(
            cause.code === 'ENOENT'
              ? unavailable(`Editor "${command}" was not found on PATH`, { command })
              : unavailable(`Cannot start editor "${command}": ${cause.message}`, { command }),
          ),
        );
      });
      child.once('exit', (code, signal) => {
        if (code === 0) resolve(ok(undefined));
        else {
          resolve(
            err(
              appError(
                'INTERNAL',
                `Editor "${command}" exited with ${signal ?? `code ${String(code)}`}`,
                { command, code, signal },
              ),
            ),
          );
        }
      });
    });
  },
});
