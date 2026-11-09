import { describe, expect, it } from 'vitest';
import { extractFields, flattenFields } from './fields.js';

describe('fields', () => {
  it('keeps only non-core keys and coerces YAML values to JSON', () => {
    const fields = extractFields({
      id: 'X',
      title: 'T',
      status: 'open',
      due: new Date(Date.UTC(2026, 10, 1)),
      amount: 12.5,
      done: false,
      owner: null,
      steps: ['a', 1],
      meta: { nested: { deep: true } },
    });
    expect(fields).toEqual({
      status: 'open',
      due: '2026-11-01',
      amount: 12.5,
      done: false,
      owner: null,
      steps: ['a', 1],
      meta: { nested: { deep: true } },
    });
  });

  it('flattens to one row per scalar, lists per element, objects as JSON', () => {
    expect(
      flattenFields({ status: 'open', steps: ['a', 1, { x: 1 }], n: null, meta: { k: true } }),
    ).toEqual([
      { key: 'status', value: 'open', kind: 'string' },
      { key: 'steps', value: 'a', kind: 'string' },
      { key: 'steps', value: '1', kind: 'number' },
      { key: 'steps', value: '{"x":1}', kind: 'json' },
      { key: 'n', value: '', kind: 'null' },
      { key: 'meta', value: '{"k":true}', kind: 'json' },
    ]);
  });
});
