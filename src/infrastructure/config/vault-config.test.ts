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

describe('vault config publications key', () => {
  const withPublications = (body: string) =>
    parseVaultConfig(parse(`vault:\n  id: V\n  name: v\npublications:\n${body}`));

  it('is absent by default', () => {
    const base = unwrap(parseVaultConfig(parse('vault:\n  id: V\n  name: v\n')));
    expect(base.publications).toBeUndefined();
    expect(toVaultConfigFile(base)).not.toHaveProperty('publications');
  });

  it('applies defaults and the string destination shorthand', () => {
    const config = unwrap(withPublications('  content:\n    destination: markdown\n    output: ./dist\n'));
    expect(config.publications?.content).toEqual({
      name: 'content',
      destination: { kind: 'markdown', options: {} },
      output: './dist',
      route: '/{{slug}}/',
      include: [],
      exclude: [],
      references: 'fail',
    });
  });

  it('keeps destination options and round-trips both forms', () => {
    const yaml =
      '  site:\n    destination:\n      kind: astro\n      theme: modular\n    output: ../site\n' +
      '    route: /posts/{{slug}}/\n    include: [posts/**]\n    references: strip-to-label\n' +
      '    vaults: [main]\n' +
      '  content:\n    destination: markdown\n    output: ./dist\n';
    const config = unwrap(withPublications(yaml));
    expect(config.publications?.site).toEqual({
      name: 'site',
      destination: { kind: 'astro', options: { theme: 'modular' } },
      output: '../site',
      route: '/posts/{{slug}}/',
      include: ['posts/**'],
      exclude: [],
      references: 'strip-to-label',
      vaults: ['main'],
    });
    const roundTripped = unwrap(parseVaultConfig(toVaultConfigFile(config)));
    expect(roundTripped.publications).toEqual(config.publications);
  });

  it('rejects an unknown reference policy', () => {
    expect(withPublications('  x:\n    destination: markdown\n    output: ./d\n    references: bogus\n')).toMatchObject(
      { ok: false, error: { code: 'VALIDATION' } },
    );
  });
});
