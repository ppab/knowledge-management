import { validation, type AppError } from '../../domain/errors.js';
import { splitFrontmatter } from '../../domain/note/frontmatter.js';
import { err, ok, type Result } from '../../domain/result.js';
import { templateVariables } from '../../domain/template/render.js';
import { parseInsertionLocation, type InsertionLocation } from '../../domain/text/insertion.js';
import type { AppDeps, TemplateSource } from '../ports.js';
import { protectPlaceholders, readDefaults, unprotectPlaceholders } from './prepare-template.js';

/**
 * A snippet is a Markdown fragment whose optional frontmatter carries a `snippet:` block:
 *
 *   snippet:
 *     at: references                     # default insertion location
 *     variables:
 *       owner: { default: "unassigned" }
 *
 * Only the body is inserted; trailing newlines are trimmed because the insertion adds its own.
 */
export interface PreparedSnippet {
  readonly name: string;
  readonly body: string;
  readonly at?: InsertionLocation;
  readonly defaults: Readonly<Record<string, string>>;
  readonly variables: readonly string[];
}

export const prepareSnippet = (
  deps: Pick<AppDeps, 'frontmatter'>,
  snippet: TemplateSource,
): Result<PreparedSnippet, AppError> => {
  const block = splitFrontmatter(snippet.source);
  const body = (block ? snippet.source.slice(block.blockRange.end) : snippet.source).replace(
    /\n+$/,
    '',
  );
  let at: InsertionLocation | undefined;
  let defaults: Record<string, string> = {};

  if (block) {
    const parsed = deps.frontmatter.parse(protectPlaceholders(block.yaml));
    if (!parsed.ok) {
      return err(
        validation(`Snippet "${snippet.name}" has invalid frontmatter: ${parsed.error.message}`),
      );
    }
    const meta = parsed.value.snippet;
    if (typeof meta === 'object' && meta !== null) {
      const { at: rawAt, variables } = meta as { at?: unknown; variables?: unknown };
      if (typeof rawAt === 'string') {
        const location = parseInsertionLocation(unprotectPlaceholders(rawAt));
        if (!location.ok) {
          return err(validation(`Snippet "${snippet.name}": ${location.error.message}`));
        }
        at = location.value;
      } else if (rawAt !== undefined) {
        return err(validation(`Snippet "${snippet.name}": snippet.at must be a string`));
      }
      defaults = readDefaults(variables);
    }
  }
  return ok({
    name: snippet.name,
    body,
    ...(at !== undefined && { at }),
    defaults,
    variables: templateVariables(body),
  });
};
