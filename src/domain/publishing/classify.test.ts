import { describe, expect, it } from 'vitest';
import { asEntryId } from '../entry/entry-id.js';
import type { Reference } from '../reference/reference.js';
import { classifyReferences } from './classify.js';
import type { PublicationCandidate } from './select.js';

const ref = (target: string): Reference => ({
  target: asEntryId(target),
  range: { start: 0, end: 0 },
});

const candidate = (id: string, references: Reference[]): PublicationCandidate => ({
  vault: 'main',
  path: `${id}.md`,
  id,
  title: `Title ${id}`,
  visibility: 'public',
  tags: [],
  dates: [],
  fields: {},
  version: 'v',
  references,
});

describe('classifyReferences', () => {
  const existing = new Map([
    ['A', { title: 'Title A' }],
    ['B', { title: 'Title B' }],
    ['EXC', { title: 'Excluded' }],
  ]);

  it('classifies each target as published, excluded, or unresolved', () => {
    const included = [candidate('A', [ref('B'), ref('EXC'), ref('GONE')]), candidate('B', [])];
    const { targets } = classifyReferences(included, existing, 'keep-id');
    expect(targets.get('B')).toEqual({ state: 'published', title: 'Title B' });
    expect(targets.get('EXC')).toEqual({ state: 'excluded', title: 'Excluded' });
    expect(targets.get('GONE')).toEqual({ state: 'unresolved' });
  });

  it('raises a violation per non-published reference only under the fail policy', () => {
    const included = [candidate('A', [ref('B'), ref('EXC'), ref('GONE')]), candidate('B', [])];
    expect(classifyReferences(included, existing, 'keep-id').violations).toEqual([]);
    const failed = classifyReferences(included, existing, 'fail').violations;
    expect(failed.map((v) => [v.target, v.state])).toEqual([
      ['EXC', 'excluded'],
      ['GONE', 'unresolved'],
    ]);
    expect(failed[0]?.source).toEqual({ vault: 'main', path: 'A.md', id: 'A' });
  });

  it('a target reachable from two emitted notes resolves to published', () => {
    const included = [candidate('A', [ref('B')]), candidate('B', [])];
    const { targets } = classifyReferences(included, existing, 'fail');
    expect(targets.get('B')?.state).toBe('published');
  });
});
