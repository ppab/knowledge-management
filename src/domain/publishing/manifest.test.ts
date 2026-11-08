import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { buildPlan } from './plan.js';
import { buildManifest } from './manifest.js';
import type { Publication } from './publication.js';
import type { PublicationCandidate } from './select.js';

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

const publication: Publication = {
  name: 'site',
  destination: { kind: 'html', options: {} },
  output: './dist',
  route: '/{{slug}}/',
  include: [],
  exclude: [],
  references: 'fail',
};

describe('buildManifest', () => {
  it('projects the plan into a deterministic index with output paths', () => {
    const notes = [
      candidate({ id: 'A', path: 'a.md', title: 'Alpha', tags: ['x'], dates: ['2026-01-01'] }),
    ];
    const plan = unwrap(buildPlan(publication, 'main', '/vault/dist', notes, new Map()));
    const manifest = buildManifest(plan, new Map([['A', 'alpha/index.html']]));
    expect(manifest).toEqual({
      publication: 'site',
      destination: 'html',
      entries: [
        {
          id: 'A',
          title: 'Alpha',
          route: '/alpha/',
          path: 'alpha/index.html',
          dates: ['2026-01-01'],
          tags: ['x'],
          source: { vault: 'main', path: 'a.md' },
        },
      ],
    });
  });
});
