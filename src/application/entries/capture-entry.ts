import { conflict, validation, type AppError } from '../../domain/errors.js';
import type { FieldValue } from '../../domain/entry/fields.js';
import { generateEntryId } from '../../domain/identity/identity.js';
import { wrapFrontmatter } from '../../domain/entry/frontmatter.js';
import { slugify, type Entry } from '../../domain/entry/entry.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  renderTemplate,
  templateVariables,
  type TemplateVariables,
} from '../../domain/template/render.js';
import { inclusionOf } from '../../domain/vault/glob.js';
import { normalizeVaultPath, resolveTemplatePath } from '../../domain/vault/paths.js';
import { globStaticPrefix } from '../../domain/vault/vault.js';
import type { AppDeps, TemplateSource } from '../ports.js';
import {
  prepareTemplate,
  unprotectPlaceholders,
  type PreparedTemplate,
} from '../templates/prepare-template.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadEntry } from './load-entry.js';

export interface CaptureEntryInput {
  readonly title: string;
  /** Template name under `.ofl/templates/`; the built-in `default` when omitted. */
  readonly template?: string;
  readonly variables?: TemplateVariables;
  /** Overrides the template's output path. Vault-relative; must still fall under `include`. */
  readonly path?: string;
  /**
   * Frontmatter keys written as real YAML values after the template renders — the one way to
   * create a note with a numeric or reference field (a `{{placeholder}}` always lands as a
   * string). They override whatever the template wrote for the same key.
   */
  readonly fields?: Readonly<Record<string, FieldValue>>;
}

export const isoDate = (d: Date): string =>
  `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The vault's template of that name, else a built-in one (plugins register `<plugin>/<name>`). */
const findTemplate = async (
  deps: AppDeps,
  root: string,
  name: string,
  builtins: Readonly<Record<string, string>>,
): Promise<Result<TemplateSource, AppError>> => {
  const own = await deps.templates.getTemplate(root, name);
  if (own.ok || own.error.code !== 'NOT_FOUND') return own;
  const builtin = builtins[name];
  return builtin === undefined ? own : ok({ name, source: builtin });
};

/**
 * The template names `capture` accepts in `vault`: its own under `.ofl/templates/` plus the
 * enabled plugins' built-ins (`<plugin>/<name>`); `default` first, then alphabetical.
 */
export const availableTemplates = async (
  deps: AppDeps,
  vault: VaultHandle,
  builtinTemplates: Readonly<Record<string, string>> = {},
): Promise<string[]> => {
  const own = await deps.templates.listTemplates(vault.root);
  const names = new Set(['default', ...own, ...Object.keys(builtinTemplates)]);
  return [...names].sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b),
  );
};

/** The variables every template may use, before the identity is generated. */
const baseVariables = (
  vault: VaultHandle,
  template: PreparedTemplate,
  title: string,
  now: Date,
  entriesDir: string,
): TemplateVariables => ({
  title,
  slug: slugify(title),
  date: isoDate(now),
  datetime: now.toISOString(),
  vault: vault.config.name,
  type: template.type,
  entriesDir,
});

/** The vault-relative path a template writes, before normalization (see `resolveTemplatePath`). */
const templateOutputPath = (
  template: PreparedTemplate,
  variables: TemplateVariables,
  entriesDir: string,
): string => {
  const text = unprotectPlaceholders(template.pathTemplate ?? `${variables.slug ?? ''}.md`);
  // Placeholders without a value stay visible rather than failing: a preview shows `{{id}}`
  // where the identity will go; `captureEntry` has already checked that nothing is missing.
  const known = Object.fromEntries(
    templateVariables(text).map((name) => [name, variables[name] ?? `{{${name}}}`]),
  );
  const rendered = renderTemplate(text, known);
  return resolveTemplatePath(rendered.ok ? rendered.value : text, entriesDir);
};

export interface TemplatePreview {
  readonly name: string;
  /** Where a note with this title would land; an unusable template says why instead. */
  readonly path: string;
}

/**
 * `availableTemplates` with the output path each would give a note titled `title`, for a
 * picker. Identity placeholders are left as `{{id}}` since no id is generated for a preview.
 */
export const previewTemplates = async (
  deps: AppDeps,
  vault: VaultHandle,
  title: string,
  builtinTemplates: Readonly<Record<string, string>> = {},
): Promise<TemplatePreview[]> => {
  const names = await availableTemplates(deps, vault, builtinTemplates);
  const entriesDir = globStaticPrefix(vault.config.include[0] ?? '');
  const now = deps.clock.now();
  return Promise.all(
    names.map(async (name): Promise<TemplatePreview> => {
      const source = await findTemplate(deps, vault.root, name, builtinTemplates);
      const template = source.ok ? prepareTemplate(deps, source.value) : source;
      if (!template.ok) return { name, path: `invalid: ${template.error.message}` };
      const variables = {
        ...template.value.defaults,
        ...baseVariables(vault, template.value, title, now, entriesDir),
      };
      const raw = templateOutputPath(template.value, variables, entriesDir);
      const path = normalizeVaultPath(raw);
      return { name, path: path.ok ? path.value : raw };
    }),
  );
};

export const captureEntry = async (
  deps: AppDeps,
  vault: VaultHandle,
  input: CaptureEntryInput,
  builtinTemplates: Readonly<Record<string, string>> = {},
): Promise<Result<Entry, AppError>> => {
  if (input.title.trim() === '') return err(validation('Title must not be empty'));

  const source = await findTemplate(
    deps,
    vault.root,
    input.template ?? 'default',
    builtinTemplates,
  );
  if (!source.ok) return source;
  const template = prepareTemplate(deps, source.value);
  if (!template.ok) return template;

  const now = deps.clock.now();
  const id = generateEntryId(
    vault.config.identity,
    { vault: vault.config.name, type: template.value.type, date: now },
    deps.unique,
  );
  if (!id.ok) return id;

  const entriesDir = globStaticPrefix(vault.config.include[0] ?? '');
  // Built-ins win over user variables so a `--var id=...` can never forge an identity.
  const variables: TemplateVariables = {
    ...template.value.defaults,
    ...input.variables,
    ...baseVariables(vault, template.value, input.title, now, entriesDir),
    id: id.value,
  };

  // Validate every placeholder up front so nothing is generated or written on a gap.
  const missing = template.value.variables.filter((v) => variables[v] === undefined);
  if (missing.length > 0) {
    return err(
      validation(`Template "${template.value.name}" needs variable(s): ${missing.join(', ')}`, {
        missing,
      }),
    );
  }
  const substitute = (text: string): string => {
    const rendered = renderTemplate(unprotectPlaceholders(text), variables);
    return rendered.ok ? rendered.value : text;
  };

  const yaml = deps.frontmatter.update(template.value.protectedYaml ?? '', {
    mapStrings: substitute,
    remove: ['template'],
    // Every note records when it was created; a template may set `created` itself.
    setIfMissing: { id: id.value, title: input.title, created: now.toISOString() },
  });
  if (!yaml.ok) return yaml;
  // Obsidian resolves `[[id]]` only against a note's filename or its frontmatter `aliases:`,
  // never against our `id:` field. Carry the id as an alias (id first, deduped) so links the
  // app writes to this note resolve in Obsidian too. This covers the built-in and any user
  // template in one place, rather than editing template text.
  const parsed = deps.frontmatter.parse(yaml.value);
  if (!parsed.ok) return parsed;
  const rawAliases: unknown = parsed.value.aliases;
  const existingAliases: string[] = Array.isArray(rawAliases)
    ? rawAliases.filter((a): a is string => typeof a === 'string')
    : typeof rawAliases === 'string'
      ? [rawAliases]
      : [];
  let yamlText = yaml.value;
  if (!existingAliases.includes(id.value)) {
    const withAlias = deps.frontmatter.update(yaml.value, {
      set: { aliases: [id.value, ...existingAliases] },
    });
    if (!withAlias.ok) return withAlias;
    yamlText = withAlias.value;
  }
  // Typed fields are written last as real YAML, so a numeric or reference field a template can
  // only express as a string (`{{placeholder}}`) lands with its true type.
  if (input.fields && Object.keys(input.fields).length > 0) {
    const withFields = deps.frontmatter.update(yamlText, { set: input.fields });
    if (!withFields.ok) return withFields;
    yamlText = withFields.value;
  }
  const body = substitute(template.value.body);
  const content = wrapFrontmatter(yamlText) + body;

  // A template's path is relative to the notes directory (`/` anchors it at the vault root);
  // `--path` is vault-relative as documented. Either way the note must land where the vault
  // looks for notes, or it would be invisible to every list, search and link.
  const rawPath = input.path ?? templateOutputPath(template.value, variables, entriesDir);
  const path = normalizeVaultPath(rawPath);
  if (!path.ok) return path;
  const inclusion = inclusionOf(vault.config, path.value);
  if (inclusion.kind !== 'included') {
    const reason =
      inclusion.kind === 'excluded'
        ? `it is excluded by ${inclusion.by}`
        : `it is not matched by include ${inclusion.include.join(', ')}`;
    return err(
      validation(`Refusing to create ${path.value}: ${reason}, so the vault would not see it`, {
        path: path.value,
        include: vault.config.include,
        exclude: vault.config.exclude,
      }),
    );
  }

  const written = await deps.entries.write(vault.root, path.value, content, { createOnly: true });
  if (!written.ok) {
    return written.error.code === 'CONFLICT'
      ? err(conflict(`Refusing to overwrite existing file ${path.value}`, { path: path.value }))
      : written;
  }
  const entry = loadEntry(deps, {
    path: path.value,
    source: content,
    version: written.value.version,
  });
  if (entry.kind !== 'entry') {
    return err(validation('Created note is not identifiable; check the template', { path }));
  }
  return ok(entry);
};
