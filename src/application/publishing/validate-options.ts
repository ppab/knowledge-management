import { validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Destination } from './destination.js';

/*
 * The one place a destination's `options` are validated. It consumes whatever the destination
 * declares via `options(chosen)` — no destination hand-parses config any more. The application
 * layer cannot import zod (it lives in infrastructure), so this is small and explicit: reject a
 * non-mapping, reject unknown keys, apply defaults, enforce `required`, and check each value
 * against its spec's type (or enum membership). The returned record (defaults applied) becomes
 * `ResolvedPublication.options`, which the destination then reads without re-validating.
 */

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

export const validateOptions = (
  destination: Destination,
  raw: unknown,
): Result<Record<string, unknown>, AppError> => {
  const given = raw ?? {};
  if (!isObject(given)) return err(validation('destination options must be a mapping'));

  // One call; the destination resolves any dependent enum from what was given (e.g. astro reads
  // `given.theme` to list that theme's collections).
  const specs = destination.options(given);
  const accepted = new Set(specs.map((s) => s.name));
  const unknownKeys = Object.keys(given).filter((key) => !accepted.has(key));
  if (unknownKeys.length > 0) {
    return err(
      validation(`unknown destination option(s): ${unknownKeys.join(', ')}`, {
        unknown: unknownKeys,
        accepted: [...accepted],
      }),
    );
  }

  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    const provided = given[spec.name];
    const value = provided === undefined ? spec.default : provided;
    if (value === undefined) {
      if (spec.required === true) {
        return err(
          validation(`destination option "${spec.name}" is required`, { option: spec.name }),
        );
      }
      continue;
    }
    if (spec.type === 'enum') {
      const values = spec.values ?? [];
      if (typeof value !== 'string' || !values.includes(value)) {
        return err(
          validation(`destination option "${spec.name}" must be one of: ${values.join(', ')}`, {
            option: spec.name,
            values: [...values],
          }),
        );
      }
    } else if (typeof value !== spec.type) {
      return err(
        validation(`destination option "${spec.name}" must be a ${spec.type}`, {
          option: spec.name,
        }),
      );
    }
    out[spec.name] = value;
  }
  return ok(out);
};
