import { conflict, validation, type AppError } from '../../domain/errors.js';
import { generateNoteId } from '../../domain/identity/identity.js';
import { wrapFrontmatter } from '../../domain/note/frontmatter.js';
import { slugify, type Note } from '../../domain/note/note.js';
import { err, ok, type Result } from '../../domain/result.js';
import { renderTemplate, type TemplateVariables } from '../../domain/template/render.js';
import { normalizeVaultPath } from '../../domain/vault/paths.js';
import { globStaticPrefix } from '../../domain/vault/vault.js';
import type { AppDeps } from '../ports.js';
import { prepareTemplate, unprotectPlaceholders } from '../templates/prepare-template.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadNoteEntry } from './load-note.js';

export interface CreateNoteInput {
  readonly title: string;
  /** Template name under `.notes/templates/`; the built-in `default` when omitted. */
  readonly template?: string;
  readonly variables?: TemplateVariables;
  /** Overrides the template's output path. Vault-relative. */
  readonly path?: string;
}

export const isoDate = (d: Date): string =>
  `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const createNote = async (
  deps: AppDeps,
  vault: VaultHandle,
  input: CreateNoteInput,
): Promise<Result<Note, AppError>> => {
  if (input.title.trim() === '') return err(validation('Title must not be empty'));

  const source = await deps.templates.getTemplate(vault.root, input.template ?? 'default');
  if (!source.ok) return source;
  const template = prepareTemplate(deps, source.value);
  if (!template.ok) return template;

  const now = deps.clock.now();
  const id = generateNoteId(
    vault.config.identity,
    { vault: vault.config.name, type: template.value.type, date: now },
    deps.unique,
  );
  if (!id.ok) return id;

  const slug = slugify(input.title);
  const notesDir = globStaticPrefix(vault.config.include[0] ?? '');
  // Built-ins win over user variables so a `--var id=...` can never forge an identity.
  const variables: TemplateVariables = {
    ...template.value.defaults,
    ...input.variables,
    id: id.value,
    title: input.title,
    slug,
    date: isoDate(now),
    datetime: now.toISOString(),
    vault: vault.config.name,
    type: template.value.type,
    notesDir,
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
    setIfMissing: { id: id.value, title: input.title },
  });
  if (!yaml.ok) return yaml;
  const body = substitute(template.value.body);
  const content = wrapFrontmatter(yaml.value) + body;

  const rawPath =
    input.path ??
    (template.value.pathTemplate !== undefined
      ? substitute(template.value.pathTemplate)
      : notesDir === ''
        ? `${slug}.md`
        : `${notesDir}/${slug}.md`);
  const path = normalizeVaultPath(rawPath);
  if (!path.ok) return path;

  const written = await deps.notes.write(vault.root, path.value, content, { createOnly: true });
  if (!written.ok) {
    return written.error.code === 'CONFLICT'
      ? err(conflict(`Refusing to overwrite existing file ${path.value}`, { path: path.value }))
      : written;
  }
  const entry = loadNoteEntry(deps, {
    path: path.value,
    source: content,
    version: written.value.version,
  });
  if (entry.kind !== 'note') {
    return err(validation('Created note is not identifiable; check the template', { path }));
  }
  return ok(entry);
};
