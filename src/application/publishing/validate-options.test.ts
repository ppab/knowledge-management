import { describe, expect, it } from 'vitest';
import { ok } from '../../domain/result.js';
import type { Destination, OptionSpec } from './destination.js';
import { createAstroDestination } from './destinations/astro.js';
import { modularTheme } from './destinations/astro-themes/modular.js';
import { validateOptions } from './validate-options.js';

/** A destination that only declares options; the publishing methods are stubs. */
const withOptions = (options: Destination['options']): Destination => ({
  kind: 'test',
  description: 'test',
  options,
  fields: () => [],
  pathFor: () => 'x',
  linkTo: () => 'x',
  render: () => ok(''),
});

describe('validateOptions', () => {
  const layout = withOptions(() => [
    { name: 'layout', type: 'enum', values: ['flat', 'directory'], default: 'flat' },
  ]);

  it('applies defaults when a value is absent', () => {
    expect(validateOptions(layout, {})).toEqual({ ok: true, value: { layout: 'flat' } });
    expect(validateOptions(layout, undefined)).toEqual({ ok: true, value: { layout: 'flat' } });
  });

  it('rejects a non-mapping', () => {
    expect(validateOptions(layout, 'nope')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(validateOptions(layout, [])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects an unknown key and names the accepted ones', () => {
    const result = validateOptions(layout, { nope: 1 });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { unknown: ['nope'], accepted: ['layout'] } },
    });
  });

  it('rejects a value outside an enum and lists the values', () => {
    expect(validateOptions(layout, { layout: 'sideways' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { option: 'layout', values: ['flat', 'directory'] } },
    });
  });

  it('checks scalar types', () => {
    const scalars = withOptions(() => [
      { name: 's', type: 'string' },
      { name: 'b', type: 'boolean' },
    ]);
    expect(validateOptions(scalars, { s: 1 })).toMatchObject({ ok: false });
    expect(validateOptions(scalars, { b: 'yes' })).toMatchObject({ ok: false });
    expect(validateOptions(scalars, { s: 'ok', b: true })).toEqual({
      ok: true,
      value: { s: 'ok', b: true },
    });
  });

  it('enforces required options that have no default', () => {
    const req = withOptions(() => [{ name: 'key', type: 'string', required: true }]);
    expect(validateOptions(req, {})).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { option: 'key' } },
    });
    expect(validateOptions(req, { key: 'x' })).toEqual({ ok: true, value: { key: 'x' } });
  });

  it('resolves a dependent enum from the value given so far', () => {
    // `b` is valid only for a=1, `c` only for a=2.
    const dependent = withOptions((chosen) => {
      const specs: OptionSpec[] = [{ name: 'a', type: 'enum', values: ['1', '2'], default: '1' }];
      specs.push({
        name: 'x',
        type: 'enum',
        values: chosen?.a === '2' ? ['c'] : ['b'],
        default: chosen?.a === '2' ? 'c' : 'b',
      });
      return specs;
    });
    expect(validateOptions(dependent, { a: '2', x: 'c' })).toEqual({
      ok: true,
      value: { a: '2', x: 'c' },
    });
    expect(validateOptions(dependent, { a: '2', x: 'b' })).toMatchObject({ ok: false });
    expect(validateOptions(dependent, {})).toEqual({ ok: true, value: { a: '1', x: 'b' } });
  });

  describe('astro dependent collection enum', () => {
    const astro = createAstroDestination([modularTheme]);

    it('defaults to the theme and its posts collection', () => {
      expect(validateOptions(astro, {})).toEqual({
        ok: true,
        value: { theme: 'modular', collection: 'posts' },
      });
    });

    it('accepts any collection the chosen theme defines', () => {
      for (const collection of ['posts', 'pages', 'projects', 'docs']) {
        expect(validateOptions(astro, { theme: 'modular', collection })).toEqual({
          ok: true,
          value: { theme: 'modular', collection },
        });
      }
    });

    it('rejects an unknown theme and an unknown collection', () => {
      expect(validateOptions(astro, { theme: 'nope' })).toMatchObject({ ok: false });
      expect(validateOptions(astro, { collection: 'nope' })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', details: { option: 'collection' } },
      });
    });
  });
});
