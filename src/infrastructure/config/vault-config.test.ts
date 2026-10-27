import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { parseVaultConfig, toVaultConfigFile } from './vault-config.js';

describe('vault config plugins key', () => {
  it('is absent by default and round-trips when set', () => {
    const base = unwrap(parseVaultConfig(parse('vault:\n  id: V\n  name: v\n')));
    expect(base.plugins).toBeUndefined();
    expect(toVaultConfigFile(base)).not.toHaveProperty('plugins');

    const config = unwrap(
      parseVaultConfig(
        parse('vault:\n  id: V\n  name: v\nplugins:\n  todos:\n  expenses:\n    currency: EUR\n'),
      ),
    );
    // A bare key means enabled with default settings.
    expect(config.plugins).toEqual({ todos: {}, expenses: { currency: 'EUR' } });
    expect(toVaultConfigFile(config).plugins).toEqual(config.plugins);
  });

  it('rejects a plugins value that is not a mapping', () => {
    expect(parseVaultConfig(parse('vault:\n  id: V\n  name: v\nplugins: [todos]\n'))).toMatchObject(
      {
        ok: false,
        error: { code: 'VALIDATION' },
      },
    );
  });
});
