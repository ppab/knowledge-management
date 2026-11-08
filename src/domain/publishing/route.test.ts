import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { normalizeRoute, renderRoute, routeToPath, routeVariables } from './route.js';

describe('routeVariables', () => {
  it('prefers an explicit slug over the title', () => {
    expect(routeVariables({ path: 'docs/a.md', title: 'My Note', slug: 'custom', id: 'ID1' })).toEqual(
      { slug: 'custom', id: 'ID1', dir: 'docs', stem: 'a' },
    );
  });

  it('slugifies the title when no slug is set, and splits the path', () => {
    expect(routeVariables({ path: 'notes/deep/My File.md', title: 'My Note', id: 'ID1' })).toEqual({
      slug: 'my-note',
      id: 'ID1',
      dir: 'notes/deep',
      stem: 'My File',
    });
  });

  it('carries type through only when present', () => {
    expect(routeVariables({ path: 'a.md', title: 'T', id: 'ID1', type: 'post' }).type).toBe('post');
    expect(routeVariables({ path: 'a.md', title: 'T', id: 'ID1' })).not.toHaveProperty('type');
  });
});

describe('normalizeRoute', () => {
  it.each([
    ['/my-note/', '/my-note/'],
    ['foo/bar', '/foo/bar'],
    ['//foo///bar//', '/foo/bar/'],
    ['/', '/'],
    ['', '/'],
  ])('%s → %s', (input, expected) => {
    expect(unwrap(normalizeRoute(input))).toBe(expected);
  });

  it('percent-encodes characters outside the unreserved set', () => {
    expect(unwrap(normalizeRoute('/a b/c&d/'))).toBe('/a%20b/c%26d/');
  });

  it('rejects "." and ".." segments', () => {
    expect(normalizeRoute('/a/../b')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(normalizeRoute('/a/./b')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('renderRoute', () => {
  it('fills the template and canonicalizes', () => {
    const out = renderRoute('/posts/{{slug}}/', { slug: 'hi', id: 'ID1', dir: '', stem: 'hi' });
    expect(unwrap(out)).toBe('/posts/hi/');
  });

  it('reports a placeholder the candidate cannot supply', () => {
    const out = renderRoute('/{{type}}/{{slug}}/', { slug: 'hi', id: 'ID1', dir: '', stem: 'hi' });
    expect(out).toMatchObject({ ok: false, error: { code: 'VALIDATION', details: { missing: ['type'] } } });
  });
});

describe('routeToPath', () => {
  it.each([
    ['/foo/bar/', 'md', 'flat', 'foo/bar.md'],
    ['/foo/bar/', 'html', 'directory', 'foo/bar/index.html'],
    ['/', 'html', 'flat', 'index.html'],
    ['/', 'md', 'directory', 'index.md'],
  ] as const)('%s (%s, %s) → %s', (route, ext, layout, expected) => {
    expect(routeToPath(route, ext, layout)).toBe(expected);
  });
});
