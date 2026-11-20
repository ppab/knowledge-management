import { describe, expect, it } from 'vitest';
import { checkFormatVersion } from './version.js';

describe('checkFormatVersion', () => {
  const check = (version: unknown) => checkFormatVersion('Theme "x"', version, '1.4.2');

  it('accepts the current version and any older one', () => {
    for (const version of ['1.4.2', '1.4.1', '1.3.9', '0.9.12']) {
      expect(check(version)).toEqual({ ok: true, value: version });
    }
  });

  it('refuses a version newer than this ofl, comparing numbers rather than text', () => {
    for (const version of ['1.4.3', '1.5.0', '2.0.0', '1.10.0']) {
      expect(check(version)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', message: expect.stringContaining('Update ofl') as string },
      });
    }
  });

  it('refuses a missing or malformed version, showing what to write', () => {
    for (const version of [undefined, 1, '1', '1.4', 'v1.4.2', '1.4.2-beta', '']) {
      expect(check(version)).toMatchObject({
        ok: false,
        error: { message: expect.stringContaining('version: 1.4.2') as string },
      });
    }
  });
});
