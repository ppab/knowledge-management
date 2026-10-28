import { afterEach, describe, expect, it } from 'vitest';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { harness, KEYS, type Terminal } from './harness.js';

let term: Terminal | undefined;
afterEach(() => term?.unmount());

const vault = {
  bound: '---\nid: B\ntitle: Bound\ndates: [2026-10-05]\n---\n\nx\n',
  plain: '---\nid: P\ntitle: Plain\n---\n\nedited today, not bound\n',
  later:
    '---\nid: L\ntitle: Later\ntags: [work]\ndates: [2026-10-27, 2026-11-03]\n---\n\n# Later\n\nFirst line of later.\n\nSecond paragraph.\n',
};
/** The day screen's title is the bare date; the month view's status line is `date:`. */
const onDayScreen = (date: string) => (f: string) => f.startsWith(date);

describe('Calendar', () => {
  it('marks only days bound under dates:, moves by day, month and year, and opens a day', async () => {
    const h = harness((f) => {
      f.fs.files.set('bound.md', vault.bound);
      f.fs.files.set('plain.md', vault.plain);
    });
    term = h.start(); // 80 columns: the grid alone, Enter opens the day as a screen
    await term.waitFor('2 notes');
    await term.press(' ');
    const menu = await term.waitFor('Space …');
    expect(menu).toContain('c  calendar');
    await term.press('c');
    const cal = await term.waitFor('calendar · October 2026');
    expect(cal).toContain(' Mo  Tu  We  Th  Fr  Sa  Su');
    // Header and cells share one four-cell rhythm: "Th" sits over the 1st, a Thursday.
    const [, header, firstWeek] = cal.split('\n');
    expect(firstWeek).toMatch(/^ +1 {3}2 {3}3 {3}4$/);
    expect(header?.indexOf('Th')).toBe((firstWeek?.indexOf('1') ?? 0) - 1);
    expect(cal).toContain(' 5·');
    expect(cal).not.toContain('27·'); // the clock's "today" has no binding
    expect(cal).toContain('2026-10-27: 0 notes · today');

    await term.press('h', 'h', 'k', 'k', 'k'); // 27 → 25 → 4
    await term.waitFor('2026-10-04: 0 notes');
    await term.press('l');
    await term.waitFor('2026-10-05: 1 note');
    await term.press(']');
    await term.waitFor('calendar · November 2026');
    await term.press('[');
    await term.waitFor('calendar · October 2026');
    await term.press('}');
    await term.waitFor('calendar · October 2027');
    await term.press('{', 't');
    await term.waitFor('2026-10-27: 0 notes · today');
    await term.press('g');
    await term.waitFor('go to (YYYY-MM-DD or YYYY-MM):');
    await term.type('2026-10-05');
    await term.press(KEYS.enter);
    await term.waitFor('2026-10-05: 1 note');

    await term.press(KEYS.enter);
    const day = await term.waitFor((f) => onDayScreen('2026-10-05')(f) && f.includes('Bound'));
    expect(day).not.toContain('Plain');
    await term.press(KEYS.enter);
    await term.waitFor('Bound · monitor · B');
    // Three ways back: the leader chord, vim's Ctrl-o, and Esc.
    await term.press(' ', 'b');
    await term.waitFor(onDayScreen('2026-10-05'));
    await term.press(KEYS.ctrlO);
    await term.waitFor('calendar · October 2026');
    await term.press(KEYS.escape);
    await term.waitFor('2 notes');
  });

  it('rejects a jump it cannot parse and keeps the cursor', async () => {
    const h = harness((f) => {
      f.fs.files.set('plain.md', vault.plain);
    });
    term = h.start([
      { kind: 'list', cursor: 0 },
      { kind: 'calendar', cursor: '2026-10-27' },
    ]);
    await term.waitFor('calendar · October 2026');
    await term.press('g');
    await term.type('2026-13');
    await term.press(KEYS.enter);
    await term.waitFor('"2026-13" is not a month');
    expect(term.frame()).toContain('2026-10-27: 0 notes');
  });

  it('on a wide terminal lists the day beside the grid, binds with b and unbinds with x', async () => {
    const h = harness((f) => {
      f.fs.files.set('bound.md', vault.bound);
      f.fs.files.set('plain.md', vault.plain);
    });
    term = h.start(
      [
        { kind: 'list', cursor: 0 },
        { kind: 'calendar', cursor: '2026-10-05' },
      ],
      {
        columns: 120,
      },
    );
    const cal = await term.waitFor((f) => f.includes('notes on 2026-10-05') && f.includes('Bound'));
    expect(cal).toContain('│');

    await term.press('l'); // 6 October: nothing bound yet
    await term.waitFor('No notes bound to this day; b binds one.');
    await term.press(KEYS.enter);
    await term.waitFor('No notes bound to 2026-10-06; press b to bind one');

    await term.press('b');
    await term.waitFor('find:');
    await term.type('plain');
    await term.press(KEYS.enter);
    await term.waitFor('Bound Plain to 2026-10-06');
    expect(h.f.fs.files.get('plain.md')).toContain('dates:\n  - 2026-10-06');
    const marked = await term.waitFor('2026-10-06: 1 note');
    expect(marked).toContain(' 6·');
    expect(marked).toContain('Plain');

    await term.press(KEYS.enter); // into the list
    const list = await term.waitFor((f) => f.includes('notes: j/k move'));
    expect(list).toContain('▸ Plain');
    await term.press(KEYS.enter);
    await term.waitFor('Plain · monitor · P');
    await term.press(KEYS.ctrlO);
    await term.waitFor('notes: j/k move');

    await term.press('x');
    await term.waitFor('Unbound Plain from 2026-10-06');
    expect(h.f.fs.files.get('plain.md')).not.toContain('dates:');
    await term.waitFor('2026-10-06: 0 notes');
    expect(term.frame()).not.toContain('notes: j/k move'); // the list emptied; the grid has focus
    await term.press('x');
    await term.waitFor('No notes bound to 2026-10-06');
  });

  it('the day screen binds and unbinds too, for narrow terminals', async () => {
    const h = harness((f) => {
      f.fs.files.set('bound.md', vault.bound);
      f.fs.files.set('plain.md', vault.plain);
    });
    term = h.start([
      { kind: 'list', cursor: 0 },
      { kind: 'calendar', cursor: '2026-10-05' },
      { kind: 'day', date: '2026-10-05', cursor: 0 },
    ]);
    await term.waitFor(onDayScreen('2026-10-05'));
    await term.press('b');
    await term.type('plain');
    await term.press(KEYS.enter);
    await term.waitFor('Bound Plain to 2026-10-05');
    await term.waitFor((f) => f.includes('Plain') && f.includes('Bound'));
    await term.press('j', 'x');
    await term.waitFor('Unbound Plain from 2026-10-05');
    await term.waitFor((f) => !f.includes('  Plain'));
    expect(h.f.fs.files.get('bound.md')).toContain('2026-10-05');
  });

  it('the day screen shows tags and the first body lines, and h/l walk the days', async () => {
    const h = harness((f) => {
      f.fs.files.set('bound.md', vault.bound);
      f.fs.files.set('later.md', vault.later);
    });
    term = h.start([
      { kind: 'list', cursor: 0 },
      { kind: 'calendar', cursor: '2026-10-27' },
      { kind: 'day', date: '2026-10-27', cursor: 0 },
    ]);
    const day = await term.waitFor('First line of later.');
    expect(day.split('\n')[0]).toContain('2026-10-27 · today');
    expect(day).toContain('1 note');
    expect(day).toContain('▸ Later #work');
    expect(day).toContain('Second paragraph.');
    expect(day).not.toContain('# Later'); // the title heading is not an excerpt
    await term.press('h');
    await term.waitFor((f) => onDayScreen('2026-10-26')(f) && f.includes('No notes bound'));
    await term.press('l', 'l');
    await term.waitFor(onDayScreen('2026-10-28'));
    await term.press('t');
    await term.waitFor('First line of later.');
  });

  it('switches to the week, year and agenda views with one cursor date', async () => {
    const h = harness((f) => {
      f.fs.files.set('bound.md', vault.bound);
      f.fs.files.set('later.md', vault.later);
      f.fs.files.set('plain.md', vault.plain);
    });
    term = h.start([
      { kind: 'list', cursor: 0 },
      { kind: 'calendar', cursor: '2026-10-27' },
    ]);
    const month = await term.waitFor('calendar · October 2026');
    expect(month).toContain('m month  w week  y year  a agenda  d day');

    await term.press('w');
    const week = await term.waitFor('calendar · week of 2026-10-26');
    const [, header, firstRow] = week.split('\n');
    expect(header).toContain('Mo 26');
    expect(header).toContain('Tu 27 ·'); // today
    expect(header).toContain('Su  1');
    // "Later" hangs under Tuesday: its column starts where the "Tu" header does.
    expect(firstRow?.indexOf('Later')).toBe(header?.indexOf('Tu 27'));
    await term.press('j');
    await term.waitFor('calendar · week of 2026-11-02');
    expect(term.frame()).toContain('Later'); // 3 November
    await term.press('k', KEYS.enter);
    await term.waitFor((f) => onDayScreen('2026-10-27')(f) && f.includes('First line of later.'));
    await term.press(KEYS.escape);

    await term.press('y');
    const year = await term.waitFor('calendar · 2026');
    const oct = year.split('\n').find((line) => line.startsWith(' Oct')) ?? '';
    const dayColumn = (d: number) => 5 + (d - 1) * 2; // " Oct " then two cells per day
    expect(oct.charAt(dayColumn(5))).toBe('1');
    expect(oct.charAt(dayColumn(27))).toBe('1');
    expect(oct.charAt(dayColumn(6))).toBe('·');
    const feb = year.split('\n').find((line) => line.startsWith(' Feb')) ?? '';
    expect(feb.trimEnd().length).toBe(dayColumn(28) + 1); // no cells past the 28th
    expect(year).toContain('2026-10-27: 1 note · today');
    await term.press('j');
    await term.waitFor('2026-11-27: 0 notes');
    await term.press('k', 'l', KEYS.enter);
    await term.waitFor('calendar · October 2026');
    await term.waitFor('2026-10-28: 0 notes');

    await term.press('a');
    const agenda = await term.waitFor('date        title');
    const rows = agenda.split('\n').filter((line) => /2026-10-\d\d|▸/.test(line));
    expect(rows[0]).toContain('2026-10-05  Bound');
    expect(rows[1]).toContain('▸ 2026-10-27  Later  work'); // lands on the cursor date
    await term.press('k');
    await term.waitFor('▸ 2026-10-05  Bound');
    await term.press(KEYS.enter);
    await term.waitFor('Bound · monitor · B');
    await term.press(KEYS.ctrlO);
    await term.waitFor('▸ 2026-10-05  Bound');
    await term.press('x');
    await term.waitFor('Unbound Bound from 2026-10-05');
    await term.waitFor((f) => !f.includes('2026-10-05  Bound'));
    await term.press(']');
    await term.waitFor('calendar · November 2026');
    await term.waitFor('2026-11-03  Later');
    await term.press('m');
    await term.waitFor(' 3·');
  });

  it('Space d binds the open note to a typed date', async () => {
    const h = harness((f) => {
      f.fs.files.set('plain.md', vault.plain);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'P' })]);
    await term.waitFor('Plain · monitor · P');
    await term.press(' ');
    const menu = await term.waitFor('Space …');
    expect(menu).toContain('d  bind to date');
    await term.press('d');
    await term.waitFor('bind to date (YYYY-MM-DD):');
    await term.type('2026-10-31');
    await term.press(KEYS.enter);
    await term.waitFor('Bound Plain to 2026-10-31');
    expect(h.f.fs.files.get('plain.md')).toContain('dates:\n  - 2026-10-31');

    await term.press(' ', 'd');
    await term.type('halloween');
    await term.press(KEYS.enter);
    await term.waitFor('"halloween" is not a date');
  });
});
