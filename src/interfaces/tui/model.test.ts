import { describe, expect, it } from 'vitest';
import { initialStack, navigate, noteScreen, windowStart } from './model.js';

describe('screen stack', () => {
  it('pushes, updates the top only and pops back to the untouched entry', () => {
    let stack = initialStack();
    stack = navigate(stack, { type: 'push', screen: noteScreen({ query: 'A' }) });
    stack = navigate(stack, {
      type: 'update',
      update: (s) => (s.kind === 'note' ? { ...s, scroll: 7 } : s),
    });
    stack = navigate(stack, { type: 'push', screen: noteScreen({ query: 'B' }) });
    expect(stack).toHaveLength(3);
    stack = navigate(stack, { type: 'pop' });
    expect(stack[1]).toMatchObject({ kind: 'note', locator: { query: 'A' }, scroll: 7 });
    stack = navigate(stack, { type: 'pop' });
    stack = navigate(stack, { type: 'pop' }); // the root stays
    expect(stack).toEqual(initialStack());
  });

  it('keeps the cursor inside the window', () => {
    expect(windowStart(0, 5)).toBe(0);
    expect(windowStart(4, 5)).toBe(0);
    expect(windowStart(5, 5)).toBe(1);
    expect(windowStart(3, 0)).toBe(3);
  });
});
