import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { unavailable, validation, type AppError } from '../../domain/errors.js';
import {
  ASTRO_THEME_FILE,
  ASTRO_THEMES_DIR,
  type AstroThemeSpec,
} from '../../domain/publishing/astro-theme.js';
import { err, ok, type Result } from '../../domain/result.js';
import { globStaticPrefix, VAULT_DIR, type VaultConfig } from '../../domain/vault/vault.js';
import type { VaultRepository } from '../../application/ports.js';
import { parseAstroTheme } from '../config/astro-theme-file.js';
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

/**
 * The Astro themes a vault defines: every `.ofl/astro-themes/<name>/theme.yaml`, in name order.
 * No directory means no themes; a directory without the file is not a theme and is skipped. A
 * theme that cannot be read or does not validate fails the load, naming its file — like the
 * config itself, a broken theme blocks the vault from opening.
 */
const loadAstroThemes = async (
  root: string,
): Promise<Result<Record<string, AstroThemeSpec>, AppError>> => {
  const dir = join(root, VAULT_DIR, ASTRO_THEMES_DIR);
  let names: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    names = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return ok({});
  }
  const themes: Record<string, AstroThemeSpec> = {};
  for (const name of names) {
    const file = join(dir, name, ASTRO_THEME_FILE);
    if (!(await isFile(file))) continue;
    let data: unknown;
    try {
      data = parseYaml(await readFile(file, 'utf8'));
    } catch (cause) {
      return err(validation(`Invalid YAML in ${file}`, { cause: String(cause) }));
    }
    const theme = parseAstroTheme(name, data);
    if (!theme.ok) {
      return err(validation(`${theme.error.message} (${file})`, { ...theme.error.details, file }));
    }
    themes[name] = theme.value;
  }
  return ok(themes);
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
    const config = parseVaultConfig(data);
    if (!config.ok) return config;
    const themes = await loadAstroThemes(root);
    if (!themes.ok) return themes;
    return ok(
      Object.keys(themes.value).length === 0
        ? config.value
        : { ...config.value, astroThemes: themes.value },
    );
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
      // The directory new notes go to exists from the start, so `capture` and editors find it.
      const entriesDir = globStaticPrefix(config.include[0] ?? '');
      if (entriesDir !== '') await mkdir(join(root, entriesDir), { recursive: true });
    } catch (cause) {
      return err(unavailable(`Cannot initialize vault at ${root}`, { cause: String(cause) }));
    }
    return ok(undefined);
  },
});
