import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { asNoteId } from '../note/note-id.js';
import type { Reference } from '../reference/reference.js';
import type { Publication } from './publication.js';
import { buildPlan, isPublishable } from './plan.js';
import type { PublicationCandidate } from './select.js';

const ref = (target: string): Reference => ({
  target: asNoteId(target),
  range: { start: 0, end: 0 },
});

const candidate = (
  overrides: Partial<PublicationCandidate> & Pick<PublicationCandidate, 'id' | 'path' | 'title'>,
): PublicationCandidate => ({
  vault: 'main',
  visibility: 'public',
  tags: [],
  dates: [],
  fields: {},
  version: 'v',
  references: [],
  ...overrides,
});

const publication = (overrides: Partial<Publication>): Publication => ({
  name: 'site',
  destination: { kind: 'markdown', options: {} },
  output: './dist',
  route: '/{{slug}}/',
  include: [],
  exclude: [],
  references: 'fail',
  ...overrides,
});

describe('buildPlan', () => {
  it('assigns routes, sorts entries by route, and records exclusions and targets', () => {
    const notes = [
      candidate({ id: 'B', path: 'b.md', title: 'Beta', references: [ref('A')] }),
      candidate({ id: 'A', path: 'a.md', title: 'Alpha' }),
      candidate({ id: 'P', path: 'p.md', title: 'Priv', visibility: 'private' }),
    ];
    const existing = new Map([
      ['A', { title: 'Alpha' }],
      ['B', { title: 'Beta' }],
    ]);
    const plan = unwrap(buildPlan(publication({}), 'main', '/vault/dist', notes, existing));
    expect(plan.entries.map((e) => e.route)).toEqual(['/alpha/', '/beta/']);
    expect(plan.excluded.map((e) => e.candidate.id)).toEqual(['P']);
    expect(plan.targets.get('A')?.state).toBe('published');
    expect(isPublishable(plan)).toBe(true);
  });

  it('is unpublishable when a route collides', () => {
    const notes = [
      candidate({ id: 'A', path: 'a.md', title: 'Same', slug: 'same' }),
      candidate({ id: 'B', path: 'b.md', title: 'Same too', slug: 'same' }),
    ];
    const plan = unwrap(buildPlan(publication({}), 'main', '/vault/dist', notes, new Map()));
    expect(plan.collisions).toHaveLength(1);
    expect(isPublishable(plan)).toBe(false);
  });

  it('is unpublishable when a reference violates the fail policy', () => {
    const notes = [candidate({ id: 'A', path: 'a.md', title: 'Alpha', references: [ref('GONE')] })];
    const plan = unwrap(buildPlan(publication({}), 'main', '/vault/dist', notes, new Map()));
    expect(plan.violations.map((v) => v.target)).toEqual(['GONE']);
    expect(isPublishable(plan)).toBe(false);
  });

  it('errors, naming the entry, when a route template cannot render', () => {
    const notes = [candidate({ id: 'A', path: 'a.md', title: 'Alpha' })];
    const result = buildPlan(publication({ route: '/{{type}}/' }), 'main', '/d', notes, new Map());
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { id: 'A' } },
    });
  });
});
