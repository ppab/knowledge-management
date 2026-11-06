import { describe, expect, it } from 'vitest';
import { createChangeDispatcher } from './change-feed.js';

describe('change dispatcher', () => {
  it('delivers each tick to every subscriber', () => {
    const dispatcher = createChangeDispatcher();
    let a = 0;
    let b = 0;
    dispatcher.feed.subscribe(() => {
      a += 1;
    });
    dispatcher.feed.subscribe(() => {
      b += 1;
    });
    dispatcher.notify();
    dispatcher.notify();
    expect([a, b]).toEqual([2, 2]);
  });

  it('stops delivering after a subscriber unsubscribes', () => {
    const dispatcher = createChangeDispatcher();
    let count = 0;
    const off = dispatcher.feed.subscribe(() => {
      count += 1;
    });
    dispatcher.notify();
    off();
    dispatcher.notify();
    expect(count).toBe(1);
  });
});
