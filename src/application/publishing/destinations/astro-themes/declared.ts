import {
  REQUIRABLE_CORE_KEYS,
  type AstroCollectionSpec,
  type AstroThemeSpec,
  type FrontmatterSource,
  type RequirableCoreKey,
  type ThemeField,
} from '../../../../domain/publishing/astro-theme.js';
import type { PlanEntry } from '../../../../domain/publishing/plan.js';
import { routeVariables } from '../../../../domain/publishing/route.js';
import type { FieldSpec } from '../../../plugin/plugin.js';
import { validateFields } from '../../../plugin/validate-fields.js';
import type { EntryProblem } from '../../destination.js';
import type { AstroCollection, AstroTheme } from '../astro.js';

/*
 * Compiles a vault-declared theme (`.ofl/astro-themes/<name>/theme.yaml`, already validated at
 * load) into the `AstroTheme` contract the astro destination runs. Everything a compiled-in
 * profile does in code is driven by the declaration here: the frontmatter mapping, and the
 * requirements a note must meet before it may be published into a collection.
 */

const isCoreKey = (name: string): name is RequirableCoreKey =>
  (REQUIRABLE_CORE_KEYS as readonly string[]).includes(name);

/** Whether the entry sets a core key itself (a slug derived from the title does not count). */
const hasCoreKey = (entry: PlanEntry, key: RequirableCoreKey): boolean => {
  switch (key) {
    case 'slug':
      return entry.slug !== undefined && entry.slug.trim() !== '';
    case 'type':
      return entry.type !== undefined && entry.type.trim() !== '';
    case 'tags':
      return entry.tags.length > 0;
  }
};

/** A date or instant → `YYYY-MM-DD`; anything else is dropped. */
const toDate = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  return undefined;
};

/** One source name: the entry's resolved core value, else the note's own frontmatter. */
const lookup = (
  name: string,
  entry: PlanEntry,
  source: Readonly<Record<string, unknown>>,
): unknown => {
  switch (name) {
    case 'title':
      return entry.title;
    case 'id':
      return entry.id;
    case 'slug':
      return routeVariables(entry).slug;
    case 'type':
      return entry.type;
    case 'tags':
      return entry.tags.length > 0 ? [...entry.tags] : undefined;
    default:
      return source[name];
  }
};

const resolve = (
  spec: FrontmatterSource,
  entry: PlanEntry,
  source: Readonly<Record<string, unknown>>,
): unknown => {
  for (const name of spec.from) {
    const raw = lookup(name, entry, source);
    const value = spec.as === 'date' ? toDate(raw) : raw;
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const compileCollection = (name: string, spec: AstroCollectionSpec): AstroCollection => {
  const core = spec.fields.filter((field) => isCoreKey(field.name));
  // The ordinary fields, in the shape the shared field validator and `doctor` understand.
  const fields: FieldSpec[] = spec.fields
    .filter((field) => !isCoreKey(field.name))
    .map(({ pattern: _pattern, ...field }: ThemeField) => field);
  const patterns = spec.fields.flatMap((field) =>
    field.pattern === undefined
      ? []
      : [
          {
            name: field.name,
            source: field.pattern,
            regex: new RegExp(`^(?:${field.pattern})$`, 'u'),
          },
        ],
  );

  const problems = (entry: PlanEntry): EntryProblem[] => {
    const found: EntryProblem[] = [];
    for (const field of core) {
      if (field.required && isCoreKey(field.name) && !hasCoreKey(entry, field.name)) {
        found.push({
          field: field.name,
          message: `"${field.name}" is required by collection "${name}"`,
        });
      }
    }
    for (const issue of validateFields(fields, entry.fields)) {
      if (issue.problem === 'undeclared') continue;
      found.push({ field: issue.field, message: issue.message });
    }
    for (const { name: field, source, regex } of patterns) {
      const value = entry.fields[field];
      if (typeof value === 'string' && !regex.test(value)) {
        found.push({
          field,
          message: `"${field}" must match ${source}, got ${JSON.stringify(value)}`,
        });
      }
    }
    return found;
  };

  return {
    route: spec.route,
    ...(spec.path !== undefined && { path: spec.path }),
    images: spec.images,
    fields,
    problems,
    frontmatter: (entry, source) => {
      const out: Record<string, unknown> = {};
      for (const [key, from] of Object.entries(spec.frontmatter)) {
        const value = resolve(from, entry, source);
        if (value !== undefined) out[key] = value;
      }
      return out;
    },
  };
};

export const compileAstroTheme = (spec: AstroThemeSpec): AstroTheme => ({
  name: spec.name,
  contentDir: spec.contentDir,
  collections: Object.fromEntries(
    Object.entries(spec.collections).map(([name, collection]) => [
      name,
      compileCollection(name, collection),
    ]),
  ),
});
