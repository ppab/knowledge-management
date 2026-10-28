import { validation, type AppError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import { parseIsoDate, type DateRange, type IsoDate } from './date-binding.js';

/*
 * Pure calendar arithmetic for the TUI's month view. Everything works on ISO dates as strings
 * and UTC, so a local time zone can never shift a binding to the neighbouring day.
 */

export interface YearMonth {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export const toIsoDate = (date: Date): IsoDate =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;

const fromIsoDate = (date: IsoDate): Date => new Date(`${date}T00:00:00Z`);

export const yearMonthOf = (date: IsoDate): YearMonth => ({
  year: Number(date.slice(0, 4)),
  month: Number(date.slice(5, 7)),
});

export const monthRange = ({ year, month }: YearMonth): DateRange => ({
  from: toIsoDate(new Date(Date.UTC(year, month - 1, 1))),
  to: toIsoDate(new Date(Date.UTC(year, month, 0))),
});

export const shiftDays = (date: IsoDate, days: number): IsoDate => {
  const d = fromIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
};

/** Same day of month in another month, clamped to that month's length. */
export const shiftMonths = (date: IsoDate, months: number): IsoDate => {
  const d = fromIsoDate(date);
  const day = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return toIsoDate(first);
};

export const shiftYears = (date: IsoDate, years: number): IsoDate => shiftMonths(date, years * 12);

export const daysInMonth = ({ year, month }: YearMonth): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The Monday-first week holding `date`, as seven dates. */
export const weekDays = (date: IsoDate): IsoDate[] => {
  const lead = (fromIsoDate(date).getUTCDay() + 6) % 7;
  const monday = shiftDays(date, -lead);
  return Array.from({ length: 7 }, (_, i) => shiftDays(monday, i));
};

export const weekRange = (date: IsoDate): DateRange => {
  const days = weekDays(date);
  return { from: days[0] ?? date, to: days[6] ?? date };
};

export const yearRange = (date: IsoDate): DateRange => {
  const year = date.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
};

const YEAR_MONTH = /^(\d{4})-(\d{1,2})$/;

/** Where a typed jump lands: `YYYY-MM-DD` on that day, `YYYY-MM` on the first of that month. */
export const parseDateJump = (input: string): Result<IsoDate, AppError> => {
  const trimmed = input.trim();
  const match = YEAR_MONTH.exec(trimmed);
  if (!match) return parseIsoDate(trimmed);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return err(validation(`"${input}" is not a month (expected YYYY-MM)`));
  }
  return ok(`${match[1] ?? ''}-${pad(month, 2)}-01`);
};

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'] as const;

/** The cell after a day number: a dot for one note, a superscript count for more, `⁺` past 9. */
export const dayMarker = (count: number): string =>
  count <= 0 ? ' ' : count === 1 ? '·' : (SUPERSCRIPTS[count] ?? '⁺');

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const monthTitle = ({ year, month }: YearMonth): string =>
  `${MONTH_NAMES[month - 1] ?? ''} ${String(year)}`;

export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

export const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) => name.slice(0, 3));

/** Weeks of the month, Monday first; cells outside the month are `null`. */
export const monthGrid = ({ year, month }: YearMonth): (IsoDate | null)[][] => {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Sunday-based → Monday-based
  const cells: (IsoDate | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day++) {
    cells.push(toIsoDate(new Date(Date.UTC(year, month - 1, day))));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
};
