import { z } from 'zod';
import { validation, type AppError } from '../../domain/errors.js';
import { KNOWN_KEYS } from '../../domain/entry/frontmatter.js';
import {
  PATH_VARIABLES,
  REQUIRABLE_CORE_KEYS,
  ROUTE_VARIABLES,
  THEME_NAME,
  type AstroThemeSpec,
  type FrontmatterSource,
  type ThemeField,
} from '../../domain/publishing/astro-theme.js';
import { err, ok, type Result } from '../../domain/result.js';
import { templateVariables } from '../../domain/template/render.js';
import { checkFormatVersion } from '../../domain/version.js';

/*
 * On-disk shape of `.ofl/astro-themes/<name>/theme.yaml`:
 *
 *   version: 0.1.0                     # required: the ofl version this file was written for
 *   contentDir: src/content            # default
 *   collections:
 *     notebook:
 *       route: /notebook/{{slug}}/
 *       path: notebook/en/{{slug}}.md  # default <collection>/{{slug}}.md
 *       images: forbid                 # default allow
 *       fields:
 *         - { name: slug, required: true }
 *         - { name: kind, type: string, required: true, pattern: '[a-z0-9-]+' }
 *       frontmatter:
 *         title: title
 *         date: { from: created, as: date }
 *         summary: [summary, description]
 *
 * Everything is checked here, so a theme that loads is a theme the destination can run: unknown
 * keys, a path that escapes the content directory, an unknown placeholder or a bad pattern are
 * all configuration errors that name the file.
 */

const name = z.string().regex(THEME_NAME, 'must be lowercase letters, digits and hyphens');

/** A relative POSIX path with no `.`/`..` segments. */
const relativePath = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith('/') && !path.includes('\\'), 'must be a relative path')
  .refine(
    (path) => path.split('/').every((segment) => segment !== '' && !/^\.\.?$/.test(segment)),
    'must not contain empty, "." or ".." segments',
  );

const onlyVariables = (allowed: readonly string[]) => (text: string) =>
  templateVariables(text).every((variable) => allowed.includes(variable));

const fieldSchema = z
  .strictObject({
    name: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'date', 'enum', 'list']).optional(),
    values: z.array(z.string().min(1)).min(1).optional(),
    of: z.enum(['string', 'number', 'boolean', 'date']).optional(),
    required: z.boolean().optional(),
    pattern: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .superRefine((field, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', message: `field "${field.name}": ${message}` });
    };
    if ((REQUIRABLE_CORE_KEYS as readonly string[]).includes(field.name)) {
      // The core owns these keys; a theme can only insist the note sets them.
      if (
        field.type !== undefined ||
        field.values !== undefined ||
        field.of !== undefined ||
        field.pattern !== undefined
      ) {
        issue('is a core key and takes only "required"');
      }
      return;
    }
    if ((KNOWN_KEYS as readonly string[]).includes(field.name)) {
      issue(`is a core key; only ${REQUIRABLE_CORE_KEYS.join(', ')} can be declared`);
      return;
    }
    const type = field.type ?? 'string';
    if (type === 'enum' && field.values === undefined) issue('an enum needs "values"');
    if (type !== 'enum' && field.values !== undefined) issue('"values" needs type enum');
    if (type !== 'list' && field.of !== undefined) issue('"of" needs type list');
    if (field.pattern !== undefined) {
      if (type !== 'string') issue('"pattern" needs type string');
      try {
        new RegExp(field.pattern, 'u');
      } catch {
        issue(`"pattern" is not a valid regular expression: ${field.pattern}`);
      }
    }
  });

const sourceName = z.string().min(1);
const sourceSchema = z.union([
  sourceName,
  z.array(sourceName).min(1),
  z.strictObject({
    from: z.union([sourceName, z.array(sourceName).min(1)]),
    as: z.enum(['date']).optional(),
  }),
]);

const toSource = (raw: z.output<typeof sourceSchema>): FrontmatterSource => {
  if (typeof raw === 'string') return { from: [raw] };
  if (Array.isArray(raw)) return { from: raw };
  return {
    from: typeof raw.from === 'string' ? [raw.from] : raw.from,
    ...(raw.as !== undefined && { as: raw.as }),
  };
};

const collectionSchema = z.strictObject({
  route: z
    .string()
    .startsWith('/', 'must start with "/"')
    .refine(onlyVariables(ROUTE_VARIABLES), `may only use {{${ROUTE_VARIABLES.join('}}, {{')}}}`),
  path: relativePath
    .refine((path) => /\.mdx?$/.test(path), 'must end in .md or .mdx')
    .refine(onlyVariables(PATH_VARIABLES), `may only use {{${PATH_VARIABLES.join('}}, {{')}}}`)
    .optional(),
  images: z.enum(['allow', 'forbid']).default('allow'),
  fields: z
    .array(fieldSchema)
    .default([])
    .refine(
      (fields) => new Set(fields.map((field) => field.name)).size === fields.length,
      'declares a field more than once',
    ),
  frontmatter: z.record(z.string().min(1), sourceSchema).default({ title: 'title' }),
});

const schema = z.strictObject({
  version: z.string(),
  contentDir: relativePath.default('src/content'),
  collections: z
    .record(name, collectionSchema)
    .refine((collections) => Object.keys(collections).length > 0, 'needs at least one collection'),
});

const toField = (raw: z.output<typeof fieldSchema>): ThemeField => ({
  name: raw.name,
  type: raw.type ?? 'string',
  ...(raw.values !== undefined && { values: raw.values }),
  ...(raw.of !== undefined && { of: raw.of }),
  ...(raw.required !== undefined && { required: raw.required }),
  ...(raw.pattern !== undefined && { pattern: raw.pattern }),
  ...(raw.description !== undefined && { description: raw.description }),
});

/** Validates one theme file's parsed YAML; `themeName` is the theme's directory name. */
export const parseAstroTheme = (
  themeName: string,
  data: unknown,
): Result<AstroThemeSpec, AppError> => {
  if (!THEME_NAME.test(themeName)) {
    return err(
      validation(
        `Invalid Astro theme name "${themeName}": use lowercase letters, digits and hyphens`,
        { theme: themeName },
      ),
    );
  }
  // The version is read first: a file written for a newer ofl may use keys this build does not
  // know, and the useful report is "update ofl", not a list of unrecognized keys.
  const version = checkFormatVersion(
    `Astro theme "${themeName}"`,
    typeof data === 'object' && data !== null ? (data as { version?: unknown }).version : undefined,
  );
  if (!version.ok) {
    return err(validation(version.error.message, { ...version.error.details, theme: themeName }));
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const first = issues[0];
    return err(
      validation(
        `Invalid Astro theme "${themeName}"${first ? `: ${first.path === '' ? '' : `${first.path}: `}${first.message}` : ''}`,
        { theme: themeName, issues },
      ),
    );
  }
  return ok({
    name: themeName,
    version: version.value,
    contentDir: parsed.data.contentDir,
    collections: Object.fromEntries(
      Object.entries(parsed.data.collections).map(([collection, raw]) => [
        collection,
        {
          route: raw.route,
          ...(raw.path !== undefined && { path: raw.path }),
          images: raw.images,
          fields: raw.fields.map(toField),
          frontmatter: Object.fromEntries(
            Object.entries(raw.frontmatter).map(([key, source]) => [key, toSource(source)]),
          ),
        },
      ]),
    ),
  });
};
