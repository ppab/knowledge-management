import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import {
  convert,
  formatAmount,
  formatInstant,
  formatMinutes,
  minutesBetween,
  parseInstant,
  parseUnit,
  type Unit,
} from './units.js';

const hours: Unit = { kind: 'time', name: 'hours' };
const minutes: Unit = { kind: 'time', name: 'minutes' };
const pages: Unit = { kind: 'opaque', name: 'pages' };

describe('units', () => {
  it('knows the two time units and treats any other name as opaque', () => {
    expect(parseUnit('hours')).toEqual(hours);
    expect(parseUnit('minutes')).toEqual(minutes);
    expect(parseUnit(' pages ')).toEqual(pages);
    expect(parseUnit('')).toBeNull();
    expect(parseUnit(3)).toBeNull();
    expect(parseUnit(undefined)).toBeNull();
  });

  it('converts exactly within the time dimension and never across dimensions', () => {
    expect(convert({ value: 90, unit: minutes }, hours)).toBe(1.5);
    expect(convert({ value: 2, unit: hours }, minutes)).toBe(120);
    expect(convert({ value: 40, unit: pages }, pages)).toBe(40);
    expect(convert({ value: 40, unit: pages }, hours)).toBeNull();
    expect(convert({ value: 1, unit: hours }, pages)).toBeNull();
    expect(convert({ value: 1, unit: pages }, { kind: 'opaque', name: 'km' })).toBeNull();
  });

  it('formats time as hours and minutes, other units with their name', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(210)).toBe('3h30m');
    expect(formatMinutes(89.6)).toBe('1h30m');
    expect(formatAmount(1.5, hours)).toBe('1h30m');
    expect(formatAmount(160, hours)).toBe('160h');
    expect(formatAmount(50, minutes)).toBe('50m');
    expect(formatAmount(40, pages)).toBe('40 pages');
  });
});

describe('instants', () => {
  it('accepts ISO 8601 with an offset or Z and keeps the text as written', () => {
    const local = unwrap(parseInstant('2026-10-27T09:00:00+01:00'));
    expect(local).toEqual({ iso: '2026-10-27T09:00:00+01:00', epochMs: Date.UTC(2026, 9, 27, 8) });
    expect(unwrap(parseInstant('2026-10-27T08:00Z')).epochMs).toBe(local.epochMs);
    expect(unwrap(parseInstant('2026-10-27T08:00:00.250Z')).epochMs).toBe(local.epochMs + 250);
  });

  it('rejects a local time, a date, a non-string and an impossible instant', () => {
    for (const raw of ['2026-10-27 09:00', '2026-10-27T09:00:00', '2026-10-27', 42, null]) {
      expect(parseInstant(raw)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    expect(parseInstant('2026-13-01T00:00:00Z')).toMatchObject({ ok: false });
  });

  it('measures minutes between an instant and a later instant or date', () => {
    const start = unwrap(parseInstant('2026-10-27T09:00:00+01:00'));
    expect(minutesBetween(start, unwrap(parseInstant('2026-10-27T09:55:00+01:00')))).toBe(55);
    expect(minutesBetween(start, new Date(Date.UTC(2026, 9, 27, 11)))).toBe(180);
  });

  it('writes the current time with its offset so it parses back to the same second', () => {
    const now = new Date(2026, 9, 27, 21, 14, 5, 400);
    const written = formatInstant(now);
    expect(written).toMatch(/^2026-10-27T21:14:05[+-]\d{2}:\d{2}$/);
    expect(unwrap(parseInstant(written)).epochMs).toBe(now.getTime() - 400);
  });
});
