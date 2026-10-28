import { describe, expect, it } from 'vitest';
import { inclusionOf, matchesGlob } from './glob.js';

describe('matchesGlob', () => {
  it.each([
    ['**/*.md', 'a.md'],
    ['**/*.md', 'docs/deep/er/a.md'],
    ['docs/**/*.md', 'docs/a.md'],
    ['docs/**/*.md', 'docs/decisions/2026-10-27-x.md'],
    ['notes/daily/*.md', 'notes/daily/2026-10-27.md'],
    ['*.{md,markdown}', 'readme.markdown'],
    ['notes/202?-*.md', 'notes/2026-x.md'],
    ['notes/[ab]*.md', 'notes/beta.md'],
    ['node_modules/**', 'node_modules/pkg/index.js'],
    ['.git/**', '.git/HEAD'],
    ['./docs/*.md', 'docs/a.md'],
  ])('%s matches %s', (glob, path) => {
    expect(matchesGlob(glob, path)).toBe(true);
  });

  it.each([
    ['docs/**/*.md', 'other/a.md'],
    ['docs/**/*.md', 'docs/a.txt'],
    ['docs/*.md', 'docs/deep/a.md'],
    ['notes/daily/*.md', 'notes/a.md'],
    ['*.md', 'docs/a.md'],
    ['**/*.md', '.notes/templates/t.md'],
    ['**/*.md', 'docs/.hidden.md'],
    ['notes/[ab]*.md', 'notes/gamma.md'],
    ['notes/202?-*.md', 'notes/20261-x.md'],
  ])('%s does not match %s', (glob, path) => {
    expect(matchesGlob(glob, path)).toBe(false);
  });
});

describe('inclusionOf', () => {
  const config = { include: ['notes/**/*.md'], exclude: ['notes/archive/**', 'node_modules/**'] };

  it('includes a path matched by include and by no exclude', () => {
    expect(inclusionOf(config, 'notes/decisions/x.md')).toEqual({ kind: 'included' });
  });

  it('names the include globs when nothing matches', () => {
    expect(inclusionOf(config, 'decisions/x.md')).toEqual({
      kind: 'not-included',
      include: ['notes/**/*.md'],
    });
  });

  it('names the exclude glob that rejects an otherwise included path', () => {
    expect(inclusionOf(config, 'notes/archive/old.md')).toEqual({
      kind: 'excluded',
      by: 'notes/archive/**',
    });
  });
});
