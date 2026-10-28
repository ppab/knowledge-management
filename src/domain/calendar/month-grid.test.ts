import { describe, expect, it } from 'vitest';
import {
  dayMarker,
  daysInMonth,
  monthGrid,
  weekDays,
  weekRange,
  yearRange,
  parseDateJump,
  shiftYears,
  monthRange,
  monthTitle,
  shiftDays,
  shiftMonths,
  yearMonthOf,
} from './month-grid.js';

describe('month grid', () => {
  it('lays the month out Monday first with empty leading and trailing cells', () => {
    const weeks = monthGrid({ year: 2026, month: 10 }); // 1 Oct 2026 is a Thursday
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks[4]?.slice(4)).toEqual(['2026-10-30', '2026-10-31', null]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('computes ranges, titles and shifts across month and year boundaries', () => {
    expect(monthRange({ year: 2024, month: 2 })).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthTitle(yearMonthOf('2026-10-27'))).toBe('October 2026');
    expect(shiftDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(shiftMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('shifts years, parses jumps to a day or a month, and marks counts in one cell', () => {
    expect(shiftYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(shiftYears('2026-10-27', -2)).toBe('2024-10-27');
    expect(parseDateJump(' 2026-03-09 ')).toEqual({ ok: true, value: '2026-03-09' });
    expect(parseDateJump('2026-3')).toEqual({ ok: true, value: '2026-03-01' });
    expect(parseDateJump('2026-13')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(parseDateJump('yesterday')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect([0, 1, 2, 9, 10, 40].map(dayMarker)).toEqual([' ', '·', '²', '⁹', '⁺', '⁺']);
  });

  it('finds the Monday-first week, the year range and month lengths', () => {
    expect(weekDays('2026-10-27')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(weekDays('2026-11-01')[0]).toBe('2026-10-26'); // a Sunday belongs to the week before
    expect(weekRange('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(yearRange('2026-10-27')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(daysInMonth({ year: 2024, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
  });
});
