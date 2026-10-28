import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version.js';

describe('VERSION', () => {
  it('equals the version in package.json', () => {
    const url = new URL('../../../package.json', import.meta.url);
    const { version } = JSON.parse(readFileSync(url, 'utf8')) as { version: string };
    expect(VERSION).toBe(version);
  });
});
