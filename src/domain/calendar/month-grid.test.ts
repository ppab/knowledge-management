import { describe, expect, it } from 'vitest';
import {
  monthGrid,
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
});
