import { validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';

/*
 * Units and instants for goals (docs/goals.md §3). `hours` and `minutes` are one dimension and
 * convert exactly; every other unit is an opaque name that only matches itself. Nothing here
 * guesses: a quantity that cannot be expressed in the goal's unit is reported, never summed.
 */

export const TIME_UNITS = ['hours', 'minutes'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export type Unit =
  | { readonly kind: 'time'; readonly name: TimeUnit }
  | { readonly kind: 'opaque'; readonly name: string };

export const isTimeUnit = (name: string): name is TimeUnit =>
  (TIME_UNITS as readonly string[]).includes(name);

/** The unit named by a frontmatter value; `null` for anything that is not a usable name. */
export const parseUnit = (raw: unknown): Unit | null => {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name === '') return null;
  return isTimeUnit(name) ? { kind: 'time', name } : { kind: 'opaque', name };
};

export const sameUnit = (a: Unit, b: Unit): boolean => a.kind === b.kind && a.name === b.name;

/** An amount as written, in the unit it was written in. */
export interface Quantity {
  readonly value: number;
  readonly unit: Unit;
}

const MINUTES_PER: Readonly<Record<TimeUnit, number>> = { hours: 60, minutes: 1 };

/**
 * `quantity` expressed in `to`, or `null` when the two units are not the same dimension. Time
 * units convert exactly; an opaque unit converts only to itself.
 */
export const convert = (quantity: Quantity, to: Unit): number | null => {
  if (quantity.unit.kind === 'time' && to.kind === 'time') {
    return (quantity.value * MINUTES_PER[quantity.unit.name]) / MINUTES_PER[to.name];
  }
  return sameUnit(quantity.unit, to) ? quantity.value : null;
};

/** `3h30m`, `45m`, `2h`, `0m`; rounded to whole minutes for display only. */
export const formatMinutes = (minutes: number): string => {
  const whole = Math.round(minutes);
  const sign = whole < 0 ? '-' : '';
  const h = Math.floor(Math.abs(whole) / 60);
  const m = Math.abs(whole) % 60;
  if (h === 0) return `${sign}${String(m)}m`;
  return m === 0 ? `${sign}${String(h)}h` : `${sign}${String(h)}h${String(m)}m`;
};

/** Time in `h`/`m` form, anything else as `<value> <unit>`. */
export const formatAmount = (value: number, unit: Unit): string =>
  unit.kind === 'time'
    ? formatMinutes(value * MINUTES_PER[unit.name])
    : `${String(value)} ${unit.name}`;

/** An ISO 8601 instant that carries its offset, so a timer survives a timezone change. */
export interface Instant {
  /** As written in the file. */
  readonly iso: string;
  readonly epochMs: number;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Rejects instants without an offset: a bare local time is ambiguous once the machine moves. */
export const parseInstant = (raw: unknown): Result<Instant, AppError> => {
  if (typeof raw !== 'string' || !INSTANT.test(raw)) {
    return err(
      validation('Expected an ISO 8601 instant with offset, like 2026-10-27T09:00:00+01:00', {
        received: raw,
      }),
    );
  }
  const epochMs = Date.parse(raw);
  if (!Number.isFinite(epochMs)) {
    return err(validation(`Not a valid instant: ${raw}`, { received: raw }));
  }
  return ok({ iso: raw, epochMs });
};

export const minutesBetween = (from: Instant, to: Instant | Date): number =>
  ((to instanceof Date ? to.getTime() : to.epochMs) - from.epochMs) / 60_000;

/** `now` as the file records instants: local time with its numeric offset, whole seconds. */
export const formatInstant = (now: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return (
    `${String(now.getFullYear()).padStart(4, '0')}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
};
