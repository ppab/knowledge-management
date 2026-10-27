import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { bindDate, isWithin, parseDateRange, parseIsoDate, unbindDate } from './date-binding.js';

describe('date bindings', () => {
  it('accepts real calendar dates only', () => {
    expect(unwrap(parseIsoDate('2026-02-28'))).toBe('2026-02-28');
    expect(parseIsoDate('2026-02-30')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(parseIsoDate('26-1-1')).toMatchObject({ ok: false });
    expect(parseIsoDate('2026-10-27T10:00')).toMatchObject({ ok: false });
  });

  it('parses single dates and inclusive ranges', () => {
    expect(unwrap(parseDateRange('2026-10-27'))).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    const range = unwrap(parseDateRange('2026-10-01..2026-10-31'));
    expect(range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(isWithin('2026-10-31', range)).toBe(true);
    expect(isWithin('2026-11-01', range)).toBe(false);
    expect(parseDateRange('2026-10-31..2026-10-01')).toMatchObject({ ok: false });
    expect(parseDateRange('a..b..c')).toMatchObject({ ok: false });
  });

  it('behaves as a sorted set', () => {
    expect(bindDate(['2026-03-01', '2026-01-01'], '2026-02-01')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(bindDate(['2026-01-01'], '2026-01-01')).toEqual(['2026-01-01']);
    expect(unbindDate(['2026-01-01', '2026-01-01', '2026-02-01'], '2026-01-01')).toEqual([
      '2026-02-01',
    ]);
    expect(unbindDate(['2026-01-01'], '2099-01-01')).toEqual(['2026-01-01']);
  });
});
