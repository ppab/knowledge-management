import { parseIsoDate } from '../../domain/calendar/date-binding.js';
import type { FieldValue } from '../../domain/note/fields.js';
import { parseFieldReference } from '../../domain/reference/reference.js';
import type { FieldSpec, FieldType } from './plugin.js';

/*
 * Declared-field validation, shared by `doctor` and `show`. A problem here never makes a
 * file less of a note: the core keeps indexing it, and the plugin keeps listing it.
 */

export type FieldProblem = 'missing' | 'type' | 'enum' | 'undeclared';

export interface FieldIssue {
  readonly field: string;
  readonly problem: FieldProblem;
  readonly message: string;
  /** For `enum`: the values the plugin accepts. */
  readonly allowed?: readonly string[];
}

const scalarMatches = (type: Exclude<FieldType, 'enum' | 'list'>, value: FieldValue): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && parseIsoDate(value).ok;
    case 'reference':
      return parseFieldReference(value) !== null;
  }
};

const describe = (spec: FieldSpec): string => {
  if (spec.type === 'enum') return `one of ${(spec.values ?? []).join(', ')}`;
  if (spec.type === 'list') return `a list of ${spec.of ?? 'string'}`;
  if (spec.type === 'date') return 'a date (YYYY-MM-DD)';
  if (spec.type === 'reference') return 'a note link ("[[id]]")';
  return `a ${spec.type}`;
};

const checkValue = (spec: FieldSpec, value: FieldValue): FieldIssue | null => {
  const wrongType = (): FieldIssue => ({
    field: spec.name,
    problem: 'type',
    message: `"${spec.name}" must be ${describe(spec)}, got ${JSON.stringify(value)}`,
  });
  switch (spec.type) {
    case 'enum': {
      const allowed = spec.values ?? [];
      if (typeof value === 'string' && allowed.includes(value)) return null;
      return {
        field: spec.name,
        problem: 'enum',
        message: `"${spec.name}" must be ${describe(spec)}, got ${JSON.stringify(value)}`,
        allowed,
      };
    }
    case 'list': {
      const of = spec.of ?? 'string';
      if (!Array.isArray(value)) return wrongType();
      return (value as readonly FieldValue[]).every((item) => scalarMatches(of, item))
        ? null
        : wrongType();
    }
    default:
      return scalarMatches(spec.type, value) ? null : wrongType();
  }
};

/**
 * Checks a note's fields against the specs of the plugin that owns its type. Missing required
 * fields and wrong values are problems; fields no spec mentions are reported as `undeclared`
 * so callers can show them without treating them as errors.
 */
export const validateFields = (
  specs: readonly FieldSpec[],
  fields: Readonly<Record<string, FieldValue>>,
): FieldIssue[] => {
  const issues: FieldIssue[] = [];
  const declared = new Set<string>();
  for (const spec of specs) {
    declared.add(spec.name);
    const value = fields[spec.name];
    if (value === undefined || value === null) {
      if (spec.required) {
        issues.push({
          field: spec.name,
          problem: 'missing',
          message: `"${spec.name}" is required (${describe(spec)})`,
        });
      }
      continue;
    }
    const issue = checkValue(spec, value);
    if (issue) issues.push(issue);
  }
  for (const name of Object.keys(fields)) {
    if (!declared.has(name)) {
      issues.push({ field: name, problem: 'undeclared', message: `"${name}" is not declared` });
    }
  }
  return issues;
};

export interface DescribedField {
  readonly name: string;
  readonly type: FieldType;
  readonly value: FieldValue | undefined;
  readonly issue?: FieldIssue;
}

export interface FieldDescription {
  /** Every declared field in declaration order, present or not. */
  readonly declared: readonly DescribedField[];
  readonly undeclared: readonly string[];
}

/** What `show` and the metadata panel print for a note of an owned type. */
export const describeFields = (
  specs: readonly FieldSpec[],
  fields: Readonly<Record<string, FieldValue>>,
): FieldDescription => {
  const issues = validateFields(specs, fields);
  return {
    declared: specs.map((spec) => {
      const issue = issues.find((i) => i.field === spec.name && i.problem !== 'undeclared');
      return {
        name: spec.name,
        type: spec.type,
        value: fields[spec.name],
        ...(issue && { issue }),
      };
    }),
    undeclared: issues.filter((i) => i.problem === 'undeclared').map((i) => i.field),
  };
};
