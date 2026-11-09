/*
 * Study time for the courses plugin. Only `minutes` and `hours` are understood — a study
 * session records a span of time — and they convert exactly. This is a deliberately smaller
 * cousin of goals' units: the layer boundary forbids importing another plugin's code, and
 * courses never needs opaque units. Nothing here guesses; an unknown unit is reported upstream.
 */

export const TIME_UNITS = ['minutes', 'hours'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

/** The unit a study session is measured in when `study_unit` is absent. */
export const DEFAULT_UNIT: TimeUnit = 'minutes';

const MINUTES_PER: Readonly<Record<TimeUnit, number>> = { minutes: 1, hours: 60 };

export const isTimeUnit = (name: string): name is TimeUnit =>
  (TIME_UNITS as readonly string[]).includes(name);

/** A time unit named by a frontmatter value; `null` for anything that is not one. */
export const parseUnit = (raw: unknown): TimeUnit | null => {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return isTimeUnit(name) ? name : null;
};

/** `amount` of `unit` expressed in minutes. */
export const toMinutes = (amount: number, unit: TimeUnit): number => amount * MINUTES_PER[unit];

/** An instant on the timeline, from an ISO 8601 string with offset (the timer's start/end). */
export interface Instant {
  readonly iso: string;
  readonly epochMs: number;
}

/** A parsed instant, or `null` when the value is not a usable ISO 8601 timestamp. */
export const parseInstant = (raw: unknown): Instant | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const epochMs = Date.parse(raw);
  return Number.isNaN(epochMs) ? null : { iso: raw, epochMs };
};

/** Whole minutes from `from` to `toEpochMs`, never below zero. */
export const minutesBetween = (from: Instant, toEpochMs: number): number =>
  Math.max(0, Math.round((toEpochMs - from.epochMs) / 60000));

/** `3h30m`, `45m`, `2h`, `0m`; rounded to whole minutes for display only. */
export const formatMinutes = (minutes: number): string => {
  const whole = Math.round(minutes);
  const sign = whole < 0 ? '-' : '';
  const h = Math.floor(Math.abs(whole) / 60);
  const m = Math.abs(whole) % 60;
  if (h === 0) return `${sign}${String(m)}m`;
  return m === 0 ? `${sign}${String(h)}h` : `${sign}${String(h)}h${String(m)}m`;
};
