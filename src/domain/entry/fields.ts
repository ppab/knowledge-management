import { KNOWN_KEYS } from './frontmatter.js';

/*
 * Fields are the frontmatter keys the core does not interpret (`status`, `due`, `amount`, …).
 * The file keeps them verbatim; the index stores them so plugins can query notes by field
 * without parsing every file.
 */

export type FieldScalar = string | number | boolean | null;
export type FieldValue =
  FieldScalar | readonly FieldValue[] | { readonly [key: string]: FieldValue };

export type FieldKind = 'string' | 'number' | 'boolean' | 'null' | 'json';

export interface FlatField {
  readonly key: string;
  readonly value: string;
  readonly kind: FieldKind;
}

const toFieldValue = (value: unknown): FieldValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(toFieldValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toFieldValue(v)]),
    );
  }
  return typeof value === 'bigint' ? String(value) : null;
};

/** Every frontmatter key that is not one of the core's, coerced to plain JSON values. */
export const extractFields = (
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, FieldValue>> =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => !(KNOWN_KEYS as readonly string[]).includes(key))
      .map(([key, value]) => [key, toFieldValue(value)]),
  );

/**
 * One row per scalar: lists produce a row per item (so `tags`-like fields are queryable by
 * element), nested objects are kept as JSON.
 */
export const flattenFields = (fields: Readonly<Record<string, FieldValue>>): FlatField[] => {
  const rows: FlatField[] = [];
  const scalar = (key: string, value: FieldValue): void => {
    if (value === null) rows.push({ key, value: '', kind: 'null' });
    else if (typeof value === 'string') rows.push({ key, value, kind: 'string' });
    else if (typeof value === 'number') rows.push({ key, value: String(value), kind: 'number' });
    else if (typeof value === 'boolean') rows.push({ key, value: String(value), kind: 'boolean' });
    else if (Array.isArray(value)) {
      for (const item of value as readonly FieldValue[]) {
        if (Array.isArray(item) || (typeof item === 'object' && item !== null)) {
          rows.push({ key, value: JSON.stringify(item), kind: 'json' });
        } else scalar(key, item);
      }
    } else rows.push({ key, value: JSON.stringify(value), kind: 'json' });
  };
  for (const [key, value] of Object.entries(fields)) scalar(key, value);
  return rows;
};
