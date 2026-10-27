import { describe, expect, it } from 'vitest';
import { resolveTitle, slugify } from './note.js';

describe('resolveTitle', () => {
  const h1 = { depth: 1 as const, text: 'Heading', range: { start: 0, end: 9 } };
  const h2 = { depth: 2 as const, text: 'Sub', range: { start: 0, end: 6 } };

  it('prefers frontmatter, then the first H1, then the filename stem', () => {
    expect(resolveTitle('FM', [h1], 'docs/x.md')).toBe('FM');
    expect(resolveTitle(undefined, [h2, h1], 'docs/x.md')).toBe('Heading');
    expect(resolveTitle('  ', [h2], 'docs/some-file.md')).toBe('some-file');
  });
});

describe('slugify', () => {
  it('produces url-safe slugs and never an empty string', () => {
    expect(slugify('Event Ingestion: Architecture!')).toBe('event-ingestion-architecture');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('***')).toBe('untitled');
  });
});
