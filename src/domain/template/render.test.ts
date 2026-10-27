import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { renderTemplate, templateVariables } from './render.js';

describe('renderTemplate', () => {
  it('substitutes placeholders regardless of inner whitespace', () => {
    const out = renderTemplate('# {{title}} by {{ author }} on {{date}}', {
      title: 'T',
      author: 'A',
      date: '2026-10-27',
    });
    expect(unwrap(out)).toBe('# T by A on 2026-10-27');
  });

  it('names every missing variable at once and leaves unrelated braces alone', () => {
    const out = renderTemplate('{{a}} {{b}} {not} {{ a }}', {});
    expect(out).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { missing: ['a', 'b'] } },
    });
    expect(templateVariables('{{x}} {{x}} {{y}}')).toEqual(['x', 'y']);
  });
});
