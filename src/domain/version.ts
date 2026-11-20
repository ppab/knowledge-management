import { validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';

/** The ofl version; kept equal to package.json by a test, so no file is read at runtime. */
export const OFL_VERSION = '0.1.0';

/*
 * Files whose format ofl defines (Astro themes, the `template:` block of a note template) state
 * the ofl version they were written for as `version:`. A later ofl can then change what a key
 * means and still read an older file correctly, and a build refuses a file written for a newer
 * ofl than itself rather than misreading it.
 */

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

const parts = (version: string): [number, number, number] | null => {
  const match = VERSION.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. */
const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < 3; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/**
 * Checks the `version:` a file states. `subject` names the file in the error (`Astro theme
 * "site"`). The version must be a full `major.minor.patch` and not newer than `current`.
 */
export const checkFormatVersion = (
  subject: string,
  version: unknown,
  current: string = OFL_VERSION,
): Result<string, AppError> => {
  const stated = typeof version === 'string' ? parts(version) : null;
  if (typeof version !== 'string' || stated === null) {
    return err(
      validation(
        `${subject} must state the ofl version it was written for, e.g. "version: ${current}"${version === undefined ? '' : ` (got ${JSON.stringify(version)})`}`,
        { version, current },
      ),
    );
  }
  if (compare(stated, parts(current) ?? [0, 0, 0]) > 0) {
    return err(
      validation(
        `${subject} was written for ofl ${version}; this is ofl ${current}. Update ofl to use it`,
        { version, current },
      ),
    );
  }
  return ok(version);
};
