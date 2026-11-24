import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { OFL_VERSION } from '../../domain/version.js';
import { parseAstroTheme } from './astro-theme-file.js';

/** Every case states a version; the version itself is tested on its own below. */
const theme = (yaml: string) => parseAstroTheme('site', parse(`version: 0.1.0\n${yaml}`));

const notebook = `
collections:
  notebook:
    route: /notebook/{{slug}}/
    path: notebook/en/{{slug}}.md
    images: forbid
    fields:
      - { name: slug, required: true }
      - { name: kind, required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*' }
      - { name: hideFromIndex, type: boolean }
    frontmatter:
      title: title
      date: { from: created, as: date }
      summary: [summary, description]
`;

describe('parseAstroTheme', () => {
  it('reads a collection, normalizing each frontmatter source and defaulting the rest', () => {
    const parsed = unwrap(theme(notebook));
    expect(parsed.name).toBe('site');
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.contentDir).toBe('src/content');
    expect(parsed.collections.notebook).toEqual({
      route: '/notebook/{{slug}}/',
      path: 'notebook/en/{{slug}}.md',
      images: 'forbid',
      fields: [
        { name: 'slug', type: 'string', required: true },
        { name: 'kind', type: 'string', required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*' },
        { name: 'hideFromIndex', type: 'boolean' },
      ],
      frontmatter: {
        title: { from: ['title'] },
        date: { from: ['created'], as: 'date' },
        summary: { from: ['summary', 'description'] },
      },
    });
  });

  it('defaults a bare collection to allowed images, no fields and the title alone', () => {
    const parsed = unwrap(theme('collections:\n  posts:\n    route: /posts/{{slug}}/\n'));
    expect(parsed.collections.posts).toEqual({
      route: '/posts/{{slug}}/',
      images: 'allow',
      fields: [],
      frontmatter: { title: { from: ['title'] } },
    });
  });

  it.each([
    ['no collections', 'collections: {}\n'],
    ['an unknown key', 'collections:\n  a:\n    route: /a/\n    rout: /b/\n'],
    ['a route that is not absolute', 'collections:\n  a:\n    route: a/{{slug}}/\n'],
    ['an unknown route placeholder', 'collections:\n  a:\n    route: /a/{{nope}}/\n'],
    ['a path that escapes', 'collections:\n  a:\n    route: /a/\n    path: ../a/{{slug}}.md\n'],
    ['an absolute path', 'collections:\n  a:\n    route: /a/\n    path: /a/{{slug}}.md\n'],
    [
      'a path that is not Markdown',
      'collections:\n  a:\n    route: /a/\n    path: a/{{slug}}.txt\n',
    ],
    [
      'a path placeholder that may be undefined',
      'collections:\n  a:\n    route: /a/\n    path: a/{{type}}.md\n',
    ],
    [
      'a content directory that escapes',
      'contentDir: ../content\ncollections:\n  a:\n    route: /a/\n',
    ],
    ['a collection name with capitals', 'collections:\n  Notes:\n    route: /a/\n'],
    [
      'an enum without values',
      'collections:\n  a:\n    route: /a/\n    fields: [{ name: k, type: enum }]\n',
    ],
    [
      'a pattern on a non-string',
      'collections:\n  a:\n    route: /a/\n    fields: [{ name: n, type: number, pattern: x }]\n',
    ],
    [
      'an invalid pattern',
      "collections:\n  a:\n    route: /a/\n    fields: [{ name: k, pattern: '(' }]\n",
    ],
    [
      'a typed core key',
      'collections:\n  a:\n    route: /a/\n    fields: [{ name: slug, type: string }]\n',
    ],
    [
      'a core key that cannot be required',
      'collections:\n  a:\n    route: /a/\n    fields: [{ name: created, required: true }]\n',
    ],
    [
      'a field declared twice',
      'collections:\n  a:\n    route: /a/\n    fields: [{ name: k }, { name: k }]\n',
    ],
    [
      'an unknown transform',
      'collections:\n  a:\n    route: /a/\n    frontmatter: { d: { from: created, as: year } }\n',
    ],
  ])('rejects %s', (_label, yaml) => {
    expect(theme(yaml)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('names the theme and the offending key', () => {
    const result = theme('collections:\n  a:\n    route: nope\n');
    expect(result).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining(
          'Invalid Astro theme "site": collections.a.route',
        ) as string,
      },
    });
  });

  it('rejects a theme directory name that is not a lowercase slug', () => {
    expect(
      parseAstroTheme('My Theme', parse('collections:\n  a:\n    route: /a/\n')),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('requires the ofl version it was written for, and refuses one newer than this ofl', () => {
    const body = 'collections:\n  a:\n    route: /a/\n';
    expect(parseAstroTheme('site', parse(body))).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: expect.stringContaining(`version: ${OFL_VERSION}`) as string,
      },
    });
    // A newer file is reported by its version, not by the keys this build does not recognize.
    expect(parseAstroTheme('site', parse(`version: 99.0.0\nlayouts: {}\n`))).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: expect.stringContaining('written for ofl 99.0.0') as string,
        details: { version: '99.0.0', theme: 'site' },
      },
    });
    // A bare number is not a version: `version: 1` says nothing about which ofl.
    expect(parseAstroTheme('site', parse(`version: 1\n${body}`))).toMatchObject({ ok: false });
    // An older file is still read.
    expect(parseAstroTheme('site', parse(`version: 0.0.9\n${body}`)).ok).toBe(true);
  });
});
