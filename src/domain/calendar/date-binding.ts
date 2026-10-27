import { validation, type AppError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

/*
 * Date bindings are ISO calendar dates (`YYYY-MM-DD`) listed under the frontmatter `dates:`
 * key. They are independent of file timestamps and behave as a sorted set.
 */

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const parseIsoDate = (input: string): Result<IsoDate, AppError> => {
  const match = ISO_DATE.exec(input.trim());
  if (!match) return err(validation(`"${input}" is not a date (expected YYYY-MM-DD)`));
  const [text, y, m, d] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const valid =
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d);
  return valid ? ok(text) : err(validation(`"${input}" is not a valid calendar date`));
};

export interface DateRange {
  readonly from: IsoDate;
  /** Inclusive. */
  readonly to: IsoDate;
}

/** `YYYY-MM-DD` (a one-day range) or `YYYY-MM-DD..YYYY-MM-DD`. */
export const parseDateRange = (input: string): Result<DateRange, AppError> => {
  const [first, second, ...rest] = input.split('..');
  if (first === undefined || rest.length > 0) {
    return err(validation(`"${input}" is not a date or date range (FROM..TO)`));
  }
  const from = parseIsoDate(first);
  if (!from.ok) return from;
  if (second === undefined) return ok({ from: from.value, to: from.value });
  const to = parseIsoDate(second);
  if (!to.ok) return to;
  if (to.value < from.value) {
    return err(validation(`Range end ${to.value} is before its start ${from.value}`));
  }
  return ok({ from: from.value, to: to.value });
};

export const bindDate = (dates: readonly IsoDate[], date: IsoDate): IsoDate[] =>
  [...new Set([...dates, date])].sort();

export const unbindDate = (dates: readonly IsoDate[], date: IsoDate): IsoDate[] =>
  [...new Set(dates)].filter((d) => d !== date).sort();

export const isWithin = (date: IsoDate, range: DateRange): boolean =>
  date >= range.from && date <= range.to;
