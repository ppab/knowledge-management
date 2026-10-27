import { describe, expect, it } from 'vitest';
import { andThen, err, isErr, isOk, map, ok, unwrap } from './result.js';

describe('Result', () => {
  it('maps over success and passes errors through', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(map(err('boom'), (n: number) => n * 2)).toEqual(err('boom'));
  });

  it('chains with andThen and widens the error union', () => {
    const parse = (s: string) => (/^\d+$/.test(s) ? ok(Number(s)) : err({ kind: 'nan' as const }));
    const positive = (n: number) => (n > 0 ? ok(n) : err({ kind: 'nonpositive' as const }));

    expect(andThen(parse('5'), positive)).toEqual(ok(5));
    expect(andThen(parse('0'), positive)).toEqual(err({ kind: 'nonpositive' }));
    expect(andThen(parse('x'), positive)).toEqual(err({ kind: 'nan' }));
  });

  it('narrows with isOk / isErr and unwraps only successes', () => {
    const r = ok('v');
    expect(isOk(r) && r.value).toBe('v');
    expect(isErr(err('e'))).toBe(true);
    expect(unwrap(ok(1))).toBe(1);
    expect(() => unwrap(err('e'))).toThrow(/unwrap\(\)/);
  });
});
