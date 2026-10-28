import { describe, expect, it } from 'vitest';
import type { FieldSpec } from './plugin.js';
import { describeFields, validateFields } from './validate-fields.js';

const specs: FieldSpec[] = [
  { name: 'status', type: 'enum', values: ['open', 'done'], required: true },
  { name: 'due', type: 'date' },
  { name: 'priority', type: 'number' },
  { name: 'flag', type: 'boolean' },
  { name: 'label', type: 'string' },
  { name: 'people', type: 'list' },
  { name: 'amounts', type: 'list', of: 'number' },
  { name: 'parent', type: 'reference' },
];

describe('validateFields', () => {
  it('accepts a note that matches every spec', () => {
    expect(
      validateFields(specs, {
        status: 'open',
        due: '2026-10-27',
        priority: 2,
        flag: true,
        label: 'x',
        people: ['a', 'b'],
        amounts: [1, 2.5],
      }),
    ).toEqual([]);
  });

  it('reports a missing required field, but not a missing optional one', () => {
    expect(validateFields(specs, {})).toEqual([
      expect.objectContaining({ field: 'status', problem: 'missing' }),
    ]);
    // A null value counts as absent.
    expect(validateFields(specs, { status: null })).toHaveLength(1);
  });

  it.each([
    ['status', 'later', 'enum', 'one of open, done'],
    ['status', 1, 'enum', 'one of open, done'],
    ['due', 'tomorrow', 'type', 'a date (YYYY-MM-DD)'],
    ['due', '2026-02-30', 'type', 'a date (YYYY-MM-DD)'],
    ['priority', 'high', 'type', 'a number'],
    ['flag', 'yes', 'type', 'a boolean'],
    ['label', 3, 'type', 'a string'],
    ['people', 'solo', 'type', 'a list of string'],
    ['people', [1], 'type', 'a list of string'],
    ['amounts', ['1'], 'type', 'a list of number'],
  ])('rejects %s = %j as a %s problem', (field, value, problem, expected) => {
    const issues = validateFields(specs, { status: 'open', [field]: value });
    expect(issues.map((i) => [i.field, i.problem])).toEqual([[field, problem]]);
    expect(issues[0]?.message).toContain(expected);
    if (problem === 'enum') expect(issues[0]?.allowed).toEqual(['open', 'done']);
  });

  it('lists fields no spec declares as undeclared, after the real problems', () => {
    expect(
      validateFields(specs, { status: 'nope', extra: 1, more: 'x' }).map((i) => [
        i.field,
        i.problem,
      ]),
    ).toEqual([
      ['status', 'enum'],
      ['extra', 'undeclared'],
      ['more', 'undeclared'],
    ]);
  });
});

describe('describeFields', () => {
  it('lists every declared field in order, with its value and issue, plus the undeclared ones', () => {
    const description = describeFields(specs.slice(0, 3), { due: 'soon', note: 'x' });
    expect(description.declared.map((d) => [d.name, d.type, d.value, d.issue?.problem])).toEqual([
      ['status', 'enum', undefined, 'missing'],
      ['due', 'date', 'soon', 'type'],
      ['priority', 'number', undefined, undefined],
    ]);
    expect(description.undeclared).toEqual(['note']);
  });
});

describe('reference fields', () => {
  it('accepts a wikilink and rejects a bare id, naming the expected form', () => {
    expect(validateFields(specs, { status: 'open', parent: '[[X1]]' })).toEqual([]);
    expect(validateFields(specs, { status: 'open', parent: 'X1' })).toEqual([
      {
        field: 'parent',
        problem: 'type',
        message: '"parent" must be a note link ("[[id]]"), got "X1"',
      },
    ]);
  });
});
