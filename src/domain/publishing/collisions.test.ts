import { describe, expect, it } from 'vitest';
import { findPathCollisions, findRouteCollisions } from './collisions.js';

describe('findRouteCollisions', () => {
  it('finds exact and case-insensitive route clashes', () => {
    const collisions = findRouteCollisions([
      { id: 'A', route: '/notes/' },
      { id: 'B', route: '/Notes/' },
      { id: 'C', route: '/other/' },
      { id: 'D', route: '/notes/' },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.ids).toEqual(['A', 'B', 'D']);
  });

  it('reports nothing when every route is distinct', () => {
    expect(
      findRouteCollisions([
        { id: 'A', route: '/a/' },
        { id: 'B', route: '/b/' },
      ]),
    ).toEqual([]);
  });
});

describe('findPathCollisions', () => {
  it('finds case-insensitive path clashes', () => {
    const collisions = findPathCollisions([
      { id: 'A', path: 'posts/a.md' },
      { id: 'B', path: 'posts/A.md' },
    ]);
    expect(collisions[0]?.ids).toEqual(['A', 'B']);
  });
});
