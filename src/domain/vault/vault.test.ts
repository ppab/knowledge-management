import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { normalizeVaultPath } from './paths.js';
import { globStaticPrefix } from './vault.js';

describe('normalizeVaultPath', () => {
  it('normalizes separators and dot segments', () => {
    expect(unwrap(normalizeVaultPath('docs\\./a/../b.md'))).toBe('docs/b.md');
    expect(unwrap(normalizeVaultPath('./x.md'))).toBe('x.md');
  });

  it.each([
    '../x.md',
    'a/../../x.md',
    '/abs.md',
    'C:/x.md',
    '.notes/templates/t.md',
    '',
    'docs/..',
  ])('rejects %j', (input) => {
    expect(normalizeVaultPath(input).ok).toBe(false);
  });
});

describe('globStaticPrefix', () => {
  it('returns the literal directory part of a glob', () => {
    expect(globStaticPrefix('docs/**/*.md')).toBe('docs');
    expect(globStaticPrefix('notes/daily/*.md')).toBe('notes/daily');
    expect(globStaticPrefix('**/*.md')).toBe('');
    expect(globStaticPrefix('README.md')).toBe('');
    expect(globStaticPrefix('docs/README.md')).toBe('docs');
  });
});
