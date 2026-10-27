import { afterEach, describe, expect, it } from 'vitest';
import { harness, KEYS, type Terminal } from './harness.js';

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('Calendar', () => {
  it('marks only days bound under dates:, moves by day and month, and opens a day', async () => {
    const h = harness((f) => {
      f.fs.files.set('bound.md', '---\nid: B\ntitle: Bound\ndates: [2026-10-05]\n---\n\nx\n');
      f.fs.files.set('plain.md', '---\nid: P\ntitle: Plain\n---\n\nedited today, not bound\n');
    });
    term = h.start();
    await term.waitFor('2 notes');
    await term.press('c');
    const cal = await term.waitFor('calendar · October 2026');
    expect(cal).toContain(' 5*');
    expect(cal).not.toContain('27*'); // the clock's "today" has no binding
    expect(cal).toContain('2026-10-27: 0 notes');

    await term.press('h', 'h', 'k', 'k', 'k'); // 27 → 25 → 4
    await term.waitFor('2026-10-04: 0 notes');
    await term.press('l');
    await term.waitFor('2026-10-05: 1 note');
    await term.press(']');
    await term.waitFor('calendar · November 2026');
    await term.press('[');
    await term.waitFor('calendar · October 2026');

    await term.press(KEYS.enter);
    const day = await term.waitFor('notes on 2026-10-05');
    expect(day).toContain('Bound');
    expect(day).not.toContain('Plain');
    await term.press(KEYS.enter);
    await term.waitFor('Bound · monitor · B');
    await term.press('u', 'u', KEYS.escape);
    await term.waitFor('2 notes');
  });
});
