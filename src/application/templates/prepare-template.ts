import { validation, type AppError } from '../../domain/errors.js';
import { readFrontmatterFields, splitFrontmatter } from '../../domain/note/frontmatter.js';
import { err, ok, type Result } from '../../domain/result.js';
import { templateVariables } from '../../domain/template/render.js';
import type { AppDeps, TemplateSource } from '../ports.js';

/**
 * A template is a Markdown file whose frontmatter may carry a `template:` block:
 *
 *   template:
 *     path: "docs/decisions/{{date}}-{{slug}}.md"   # output path, vault-relative
 *     variables:
 *       owner: { default: "unassigned" }            # defaults for user variables
 *
 * The block is stripped from the created note. The template's own `type` key, if any,
 * overrides the template name as the note type.
 */
export interface PreparedTemplate {
  readonly name: string;
  readonly type: string;
  /** Frontmatter YAML with placeholders protected so it parses; `null` when absent. */
  readonly protectedYaml: string | null;
  readonly body: string;
  readonly pathTemplate?: string;
  readonly defaults: Readonly<Record<string, string>>;
  /** Every placeholder used anywhere in the template. */
  readonly variables: readonly string[];
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;
const PROTECTED = /«tpl:([A-Za-z_][\w.-]*)»/g;

/** `{{x}}` is a YAML flow mapping; swap it for a plain-scalar-safe token while parsing. */
export const protectPlaceholders = (text: string): string =>
  text.replace(PLACEHOLDER, (_, name: string) => `«tpl:${name}»`);

export const unprotectPlaceholders = (text: string): string =>
  text.replace(PROTECTED, (_, name: string) => `{{${name}}}`);

/** `variables: { name: { default: ... } }` → `{ name: "..." }`; anything else is ignored. */
export const readDefaults = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [name, spec] of Object.entries(value)) {
    if (typeof spec === 'object' && spec !== null && 'default' in spec) {
      const d = (spec as { default: unknown }).default;
      if (typeof d === 'string' || typeof d === 'number' || typeof d === 'boolean') {
        out[name] = String(d);
      }
    }
  }
  return out;
};

export const prepareTemplate = (
  deps: Pick<AppDeps, 'frontmatter'>,
  template: TemplateSource,
): Result<PreparedTemplate, AppError> => {
  const block = splitFrontmatter(template.source);
  const body = block ? template.source.slice(block.blockRange.end) : template.source;
  let type = template.name;
  let protectedYaml: string | null = null;
  let pathTemplate: string | undefined;
  let defaults: Record<string, string> = {};

  if (block) {
    protectedYaml = protectPlaceholders(block.yaml);
    const parsed = deps.frontmatter.parse(protectedYaml);
    if (!parsed.ok) {
      return err(
        validation(`Template "${template.name}" has invalid frontmatter: ${parsed.error.message}`),
      );
    }
    const fields = readFrontmatterFields(parsed.value);
    if (fields.type !== undefined) type = unprotectPlaceholders(fields.type);
    const meta = parsed.value.template;
    if (typeof meta === 'object' && meta !== null) {
      const { path, variables } = meta as { path?: unknown; variables?: unknown };
      if (typeof path === 'string') pathTemplate = unprotectPlaceholders(path);
      else if (path !== undefined) {
        return err(validation(`Template "${template.name}": template.path must be a string`));
      }
      defaults = readDefaults(variables);
    }
  }

  const variables = templateVariables(
    [block ? block.yaml : '', body, pathTemplate ?? ''].join('\n'),
  );
  return ok({
    name: template.name,
    type,
    protectedYaml,
    body,
    ...(pathTemplate !== undefined && { pathTemplate }),
    defaults,
    variables,
  });
};
