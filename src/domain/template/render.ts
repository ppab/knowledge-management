import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';

/** `{{ name }}` placeholders; whitespace inside the braces is ignored. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export type TemplateVariables = Readonly<Record<string, string>>;

export const templateVariables = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '')),
];

/**
 * Substitutes placeholders. Every placeholder must have a value: templates and snippets are
 * validated before any file is touched, so a missing variable is a `VALIDATION` error naming
 * all the gaps at once.
 */
export const renderTemplate = (
  text: string,
  variables: TemplateVariables,
): Result<string, AppError> => {
  const missing = templateVariables(text).filter((name) => variables[name] === undefined);
  if (missing.length > 0) {
    return err(validation(`Missing template variable(s): ${missing.join(', ')}`, { missing }));
  }
  return ok(text.replace(PLACEHOLDER, (_, name: string) => variables[name] ?? ''));
};
