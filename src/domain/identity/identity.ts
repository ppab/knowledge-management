import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';
import { parseNoteId, type NoteId } from '../note/note-id.js';

export type IdentityConfig =
  | { readonly strategy: 'ulid' }
  | { readonly strategy: 'uuidv7' }
  | { readonly strategy: 'formatted'; readonly format: string };

/** Sources of randomness are provided by infrastructure; the domain only composes. */
export interface UniqueSource {
  ulid(): string;
  uuidv7(): string;
}

export interface IdentityContext {
  readonly vault: string;
  /** Taken from the template name, overridable by the template's frontmatter `type`. */
  readonly type?: string;
  readonly date: Date;
}

const UNIQUE_VARIABLES = ['ulid', 'uuidv7'] as const;
const CONTEXT_VARIABLES = ['vault', 'type', 'date'] as const;
const VARIABLE = /\{(\w+)\}/g;

export const formatVariables = (format: string): string[] =>
  [...format.matchAll(VARIABLE)].map((m) => m[1] ?? '');

/**
 * A custom format must preserve global uniqueness, so it has to embed at least one unique
 * component, and may only reference variables the system can supply.
 */
export const validateIdentityFormat = (format: string): Result<void, AppError> => {
  const variables = formatVariables(format);
  const known: readonly string[] = [...UNIQUE_VARIABLES, ...CONTEXT_VARIABLES];
  const unknown = variables.filter((v) => !known.includes(v));
  if (unknown.length > 0) {
    return err(
      validation(`Unknown identity format variable(s): ${unknown.join(', ')}`, { unknown }),
    );
  }
  if (!variables.some((v) => (UNIQUE_VARIABLES as readonly string[]).includes(v))) {
    return err(
      validation('Identity format must contain {ulid} or {uuidv7} to stay globally unique', {
        format,
      }),
    );
  }
  return ok(undefined);
};

export const validateIdentityConfig = (config: IdentityConfig): Result<void, AppError> =>
  config.strategy === 'formatted' ? validateIdentityFormat(config.format) : ok(undefined);

const yyyymmdd = (date: Date): string =>
  `${String(date.getFullYear()).padStart(4, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

/** Removes characters that the reference syntax forbids from a context value. */
const sanitize = (value: string): string => value.replace(/[\s|[\]]+/g, '-');

export const generateNoteId = (
  config: IdentityConfig,
  context: IdentityContext,
  unique: UniqueSource,
): Result<NoteId, AppError> => {
  switch (config.strategy) {
    case 'ulid':
      return parseNoteId(unique.ulid());
    case 'uuidv7':
      return parseNoteId(unique.uuidv7());
    case 'formatted': {
      const valid = validateIdentityFormat(config.format);
      if (!valid.ok) return valid;
      if (formatVariables(config.format).includes('type') && context.type === undefined) {
        return err(validation('Identity format uses {type} but no type is available'));
      }
      const values: Record<string, () => string> = {
        ulid: () => unique.ulid(),
        uuidv7: () => unique.uuidv7(),
        vault: () => sanitize(context.vault),
        type: () => sanitize(context.type ?? ''),
        date: () => yyyymmdd(context.date),
      };
      return parseNoteId(
        config.format.replace(VARIABLE, (_, name: string) => values[name]?.() ?? ''),
      );
    }
  }
};
