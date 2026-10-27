import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { unavailable, validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { UserConfig, UserConfigRepository } from '../../application/ports.js';

/*
 * `$XDG_CONFIG_HOME/notes/config.yaml` (default `~/.config/notes/config.yaml`):
 *
 *   scopes:
 *     work:
 *       vaults: [~/notes/work, ~/notes/team]
 *
 * Vault paths may be absolute, `~`-relative, or relative to the config file's directory.
 */

const schema = z.object({
  scopes: z
    .record(z.string().min(1), z.object({ vaults: z.array(z.string().min(1)).min(1) }))
    .default({}),
});

const errno = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined;

export const userConfigPath = (env: NodeJS.ProcessEnv, home: string): string =>
  join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'notes', 'config.yaml');

export const parseUserConfig = (
  data: unknown,
  configDir: string,
  home: string,
): Result<UserConfig, AppError> => {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    return err(
      validation('Invalid user configuration', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }),
    );
  }
  const expand = (path: string): string => {
    if (path === '~' || path.startsWith('~/')) return join(home, path.slice(1));
    return isAbsolute(path) ? path : resolve(configDir, path);
  };
  const scopes = Object.fromEntries(
    Object.entries(parsed.data.scopes).map(([name, scope]) => [
      name,
      { vaults: scope.vaults.map(expand) },
    ]),
  );
  return ok({ scopes });
};

export const createUserConfigRepository = (
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): UserConfigRepository => {
  const path = userConfigPath(env, home);
  return {
    path: () => path,
    async load() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (cause) {
        return errno(cause) === 'ENOENT'
          ? ok({ scopes: {} })
          : err(unavailable(`Cannot read ${path}`, { cause: String(cause) }));
      }
      let data: unknown;
      try {
        data = parseYaml(text);
      } catch (cause) {
        return err(validation(`Invalid YAML in ${path}`, { cause: String(cause) }));
      }
      const parsed = parseUserConfig(data, dirname(path), home);
      return parsed.ok
        ? parsed
        : err({ ...parsed.error, message: `${parsed.error.message} in ${path}` });
    },
  };
};
