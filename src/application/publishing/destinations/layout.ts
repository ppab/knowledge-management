import { validation, type AppError } from '../../../domain/errors.js';
import { err, ok, type Result } from '../../../domain/result.js';
import type { Layout } from '../../../domain/publishing/route.js';

/*
 * Shared option parsing for the file-layout destinations. The application layer cannot import
 * zod (it lives in infrastructure), so options are validated by hand — small and explicit.
 */

export interface LayoutOptions {
  readonly layout: Layout;
}

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

/** Validates `{ layout?: 'flat' | 'directory' }`, applying `fallback` when absent. */
export const parseLayoutOptions = (
  raw: unknown,
  fallback: Layout,
): Result<LayoutOptions, AppError> => {
  if (raw === undefined || raw === null) return ok({ layout: fallback });
  if (!isObject(raw)) return err(validation('destination options must be a mapping'));
  const { layout, ...rest } = raw;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) {
    return err(validation(`unknown destination option(s): ${unknown.join(', ')}`, { unknown }));
  }
  if (layout === undefined) return ok({ layout: fallback });
  if (layout !== 'flat' && layout !== 'directory') {
    return err(validation(`layout must be "flat" or "directory", got ${JSON.stringify(layout)}`));
  }
  return ok({ layout });
};
