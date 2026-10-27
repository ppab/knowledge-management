import { describe, expect, it } from 'vitest';
import { findDuplicateIds } from './duplicates.js';

describe('findDuplicateIds', () => {
  it('names every path sharing an id, ignoring unidentified files', () => {
    const duplicates = findDuplicateIds([
      { id: 'B', path: 'z.md' },
      { path: 'none.md' },
      { id: 'A', path: 'a.md' },
      { id: 'B', path: 'b.md' },
      { id: 'B', path: 'c.md' },
      { path: 'other.md' },
    ]);
    expect(duplicates).toEqual([{ id: 'B', paths: ['b.md', 'c.md', 'z.md'] }]);
    expect(findDuplicateIds([{ id: 'A', path: 'a.md' }])).toEqual([]);
  });
});
