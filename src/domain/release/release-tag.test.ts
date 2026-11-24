import { describe, expect, it } from 'vitest';
import { isReleasableName, releaseStamp, releaseTagName } from './release-tag.js';

describe('release tag', () => {
  it('stamps the instant in UTC to the second', () => {
    expect(releaseStamp(new Date('2026-11-23T14:32:00Z'))).toBe('20261123T143200Z');
    // Whatever zone the instant was written in, the stamp is UTC.
    expect(releaseStamp(new Date('2026-01-02T01:04:05+03:00'))).toBe('20260101T220405Z');
  });

  it('names the tag release/<publication>/<stamp>', () => {
    expect(releaseTagName('ppab', new Date('2026-11-23T14:32:00Z'))).toBe(
      'release/ppab/20261123T143200Z',
    );
  });

  it.each(['ppab', 'my-site', 'blog_2', 'site.v2'])('accepts %s as a ref component', (name) => {
    expect(isReleasableName(name)).toBe(true);
  });

  it.each([
    '',
    'a b',
    'a/b',
    'a..b',
    '.hidden',
    '-flag',
    'site.',
    'site.lock',
    'a:b',
    'a~1',
    'a@{b',
  ])('refuses %j as a ref component', (name) => {
    expect(isReleasableName(name)).toBe(false);
  });
});
