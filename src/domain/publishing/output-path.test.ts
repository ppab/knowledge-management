import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import {
  escapeMarkdownText,
  normalizeOutputPath,
  relativePath,
  resolveOutputDir,
} from './output-path.js';

describe('resolveOutputDir', () => {
  it('joins a relative output onto the vault root', () => {
    expect(resolveOutputDir('/vault', './dist')).toBe('/vault/dist');
    expect(resolveOutputDir('/vault/', 'out/site')).toBe('/vault/out/site');
  });

  it('passes an absolute output through, normalized', () => {
    expect(resolveOutputDir('/vault', '/srv/www')).toBe('/srv/www');
    expect(resolveOutputDir('/vault', '/srv/../www/')).toBe('/www');
  });

  it('resolves ".." lexically against the root', () => {
    expect(resolveOutputDir('/home/me/vault', '../site')).toBe('/home/me/site');
  });
});

describe('relativePath', () => {
  it.each([
    ['a/b.md', 'a/c.md', './c.md'],
    ['a/b.md', 'x/c.md', '../x/c.md'],
    ['a/b.md', 'a/d/c.md', './d/c.md'],
    ['a/deep/b.md', 'a/c.md', '../c.md'],
    ['index.md', 'a/b.md', './a/b.md'],
  ])('%s → %s is %s', (from, to, expected) => {
    expect(relativePath(from, to)).toBe(expected);
  });
});

describe('normalizeOutputPath', () => {
  it('accepts and cleans a relative path', () => {
    expect(unwrap(normalizeOutputPath('a/./b.md'))).toBe('a/b.md');
  });

  it.each(['', '/abs.md', '../escape.md', 'a/../../b.md'])('rejects %s', (path) => {
    expect(normalizeOutputPath(path)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('escapeMarkdownText', () => {
  it('escapes link-breaking characters', () => {
    expect(escapeMarkdownText('a [b] \\c')).toBe('a \\[b\\] \\\\c');
  });
});
