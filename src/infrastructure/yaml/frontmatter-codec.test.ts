import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { createFrontmatterCodec } from './frontmatter-codec.js';

const codec = createFrontmatterCodec();

describe('frontmatter codec', () => {
  it('parses mappings and rejects non-mappings and invalid yaml', () => {
    expect(unwrap(codec.parse('a: 1\nb: [x]\n'))).toEqual({ a: 1, b: ['x'] });
    expect(unwrap(codec.parse(''))).toEqual({});
    expect(codec.parse('- a\n')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(codec.parse('a: [\n')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('round-trips comments, key order, quoting and unknown keys on update', () => {
    const yaml = [
      '# header comment',
      'title: "Quoted: value" # trailing',
      'custom:',
      '  nested: true',
      "aliases: ['a', 'b']",
      'long: ' + 'word '.repeat(30).trim(),
      '',
    ].join('\n');
    const out = unwrap(codec.update(yaml, { set: { id: 'X1' } }));
    expect(out).toBe(yaml.replace(/\n$/, '\nid: X1\n'));
  });

  it('appends new keys byte-preservingly even with odd spacing and trailing comments', () => {
    const yaml = 'a:   [ 1,2 ]\n# trailing\n';
    expect(unwrap(codec.update(yaml, { set: { id: 'X' } }))).toBe(yaml + 'id: X\n');
    expect(unwrap(codec.update('a: 1', { setIfMissing: { a: 2, b: 'y' } }))).toBe('a: 1\nb: y\n');
    expect(unwrap(codec.update('# only a comment\n', { set: { id: 'X' } }))).toBe(
      '# only a comment\nid: X\n',
    );
  });

  it('replaces existing keys in place, removes keys and honours setIfMissing', () => {
    const out = unwrap(
      codec.update('id: old\ntemplate:\n  path: x\ntitle: T\n', {
        set: { id: 'new' },
        remove: ['template'],
        setIfMissing: { title: 'ignored', tags: ['t'] },
      }),
    );
    expect(out).toBe('id: new\ntitle: T\ntags:\n  - t\n');
  });

  it('maps string scalars (with yaml-safe re-quoting) and handles empty input', () => {
    const out = unwrap(
      codec.update('title: «x»\nlist: [«x», 1]\n', { mapStrings: (s) => s.replace('«x»', 'a: b') }),
    );
    expect(unwrap(codec.parse(out))).toEqual({ title: 'a: b', list: ['a: b', 1] });
    expect(unwrap(codec.update('', { set: { id: 'N' } }))).toBe('id: N\n');
    expect(unwrap(codec.update('only: 1\n', { remove: ['only'] }))).toBe('');
  });
});
