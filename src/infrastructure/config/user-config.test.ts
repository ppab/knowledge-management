import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { createUserConfigRepository, parseUserConfig } from './user-config.js';

describe('user config', () => {
  it('expands ~ and resolves relative vault paths against the config directory', () => {
    const config = unwrap(
      parseUserConfig(
        { scopes: { work: { vaults: ['~/notes', '../team', '/abs'] } } },
        '/home/u/.config/notes',
        '/home/u',
      ),
    );
    expect(config.scopes.work?.vaults).toEqual(['/home/u/notes', '/home/u/.config/team', '/abs']);
    expect(unwrap(parseUserConfig(null, '/c', '/h'))).toEqual({ scopes: {} });
    expect(parseUserConfig({ scopes: { bad: { vaults: [] } } }, '/c', '/h')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  describe('repository', () => {
    let home: string;
    beforeEach(async () => {
      home = await mkdtemp(join(tmpdir(), 'notes-cfg-'));
    });
    afterEach(() => rm(home, { recursive: true, force: true }));

    it('reads $XDG_CONFIG_HOME/notes/config.yaml and treats a missing file as empty', async () => {
      const repo = createUserConfigRepository({ XDG_CONFIG_HOME: join(home, 'xdg') }, home);
      expect(repo.path()).toBe(join(home, 'xdg', 'notes', 'config.yaml'));
      expect(unwrap(await repo.load())).toEqual({ scopes: {} });

      await mkdir(join(home, 'xdg', 'notes'), { recursive: true });
      await writeFile(repo.path(), 'scopes:\n  all:\n    vaults: [~/a, b]\n');
      expect(unwrap(await repo.load())).toEqual({
        scopes: { all: { vaults: [join(home, 'a'), join(home, 'xdg', 'notes', 'b')] } },
      });

      await writeFile(repo.path(), 'scopes: [not, a, map]\n');
      expect(await repo.load()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
      await writeFile(repo.path(), 'scopes: {a: {vaults: [x]}\n');
      expect(await repo.load()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    });

    it('defaults to ~/.config when XDG_CONFIG_HOME is unset', () => {
      expect(createUserConfigRepository({}, '/home/u').path()).toBe(
        '/home/u/.config/notes/config.yaml',
      );
    });
  });
});
