import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { unavailable, validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import { globStaticPrefix, VAULT_DIR, type VaultConfig } from '../../domain/vault/vault.js';
import type { VaultRepository } from '../../application/ports.js';
import { parseVaultConfig, toVaultConfigFile } from '../config/vault-config.js';

const CONFIG_FILE = 'config.yaml';

const configPath = (root: string): string => join(root, VAULT_DIR, CONFIG_FILE);

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

export const createVaultRepository = (): VaultRepository => ({
  async findNearest(cwd) {
    let dir = resolve(cwd);
    for (;;) {
      if (await isFile(configPath(dir))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  },

  exists: (root) => isFile(configPath(root)),

  async load(root): Promise<Result<VaultConfig, AppError>> {
    let text: string;
    try {
      text = await readFile(configPath(root), 'utf8');
    } catch (cause) {
      return err(unavailable(`Cannot read ${configPath(root)}`, { cause: String(cause) }));
    }
    let data: unknown;
    try {
      data = parseYaml(text);
    } catch (cause) {
      return err(validation(`Invalid YAML in ${configPath(root)}`, { cause: String(cause) }));
    }
    return parseVaultConfig(data);
  },

  async create(root, config) {
    const dir = join(root, VAULT_DIR);
    try {
      await mkdir(join(dir, 'templates'), { recursive: true });
      await mkdir(join(dir, 'snippets'), { recursive: true });
      await mkdir(join(dir, 'cache'), { recursive: true });
      // The cache ignores itself, so the project's own .gitignore is never touched.
      await writeFile(join(dir, 'cache', '.gitignore'), '*\n', { flag: 'wx' });
      await writeFile(join(dir, CONFIG_FILE), stringifyYaml(toVaultConfigFile(config)), {
        flag: 'wx',
      });
      // The directory new notes go to exists from the start, so `create` and editors find it.
      const notesDir = globStaticPrefix(config.include[0] ?? '');
      if (notesDir !== '') await mkdir(join(root, notesDir), { recursive: true });
    } catch (cause) {
      return err(unavailable(`Cannot initialize vault at ${root}`, { cause: String(cause) }));
    }
    return ok(undefined);
  },
});
