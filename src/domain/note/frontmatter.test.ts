import { describe, expect, it } from 'vitest';
import { readFrontmatterFields, splitFrontmatter, wrapFrontmatter } from './frontmatter.js';

describe('splitFrontmatter', () => {
  it('locates the yaml between fences and the whole block', () => {
    const source = '---\ntitle: X\n---\n# X\n';
    const block = splitFrontmatter(source)!;
    expect(block.yaml).toBe('title: X\n');
    expect(source.slice(block.yamlRange.start, block.yamlRange.end)).toBe('title: X\n');
    expect(source.slice(block.blockRange.end)).toBe('# X\n');
  });

  it('handles CRLF, empty blocks and the "..." terminator', () => {
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\nbody')!.yaml).toBe('a: 1\r\n');
    expect(splitFrontmatter('---\n---\nbody')!.yaml).toBe('');
    expect(splitFrontmatter('---\na: 1\n...\nbody')!.blockRange.end).toBe(13);
  });

  it('returns null when there is no frontmatter or no closing fence', () => {
    expect(splitFrontmatter('# Title\n---\n')).toBeNull();
    expect(splitFrontmatter('---\nnever closed')).toBeNull();
    expect(splitFrontmatter(' ---\nx\n---\n')).toBeNull();
  });

  it('does not treat a horizontal rule inside yaml-looking text as a fence boundary', () => {
    const block = splitFrontmatter('---\na: 1\n  ---\n---\n')!;
    expect(block.yaml).toBe('a: 1\n  ---\n');
  });

  it('wraps yaml in fences', () => {
    expect(wrapFrontmatter('id: x\n')).toBe('---\nid: x\n---\n');
    expect(wrapFrontmatter('id: x')).toBe('---\nid: x\n---\n');
  });
});

describe('readFrontmatterFields', () => {
  it('coerces scalars and lists leniently and defaults visibility to private', () => {
    const fields = readFrontmatterFields({
      id: 42,
      title: 'T',
      aliases: 'single',
      dates: [new Date('2026-10-23T12:00:00Z'), '2026-10-23', '2026-10-24'],
      tags: ['a', 1],
      extra: { kept: true },
    });
    expect(fields).toMatchObject({
      id: '42',
      title: 'T',
      aliases: ['single'],
      dates: ['2026-10-23', '2026-10-24'],
      tags: ['a', '1'],
      visibility: 'private',
      issues: [],
    });
  });

  it('reports problems with recognized keys without failing', () => {
    const fields = readFrontmatterFields({ visibility: 'internal', tags: [{}], title: [] });
    expect(fields.visibility).toBe('private');
    expect(fields.issues).toEqual([
      '"visibility" must be "public" or "private"',
      '"title" must be a string',
      '"tags" contains a non-string entry',
    ]);
  });
});
