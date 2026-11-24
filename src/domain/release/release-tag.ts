/*
 * A release is a mark on the repository, not an output: an annotated tag naming the publication
 * and the instant it was cut. Whatever watches the repository (CI) publishes from the tagged
 * commit; `release` itself writes no publication.
 */

/** Every release tag lives under this prefix, so a CI trigger is one glob: `release/**`. */
export const RELEASE_TAG_PREFIX = 'release';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `20261123T143200Z`: the instant in UTC, to the second, with nothing a ref name refuses. */
export const releaseStamp = (at: Date): string =>
  `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
  `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;

/** `release/<publication>/<stamp>`, e.g. `release/ppab/20261123T143200Z`. */
export const releaseTagName = (publication: string, at: Date): string =>
  `${RELEASE_TAG_PREFIX}/${publication}/${releaseStamp(at)}`;

/*
 * The publication name becomes one component of a ref, so it must be one git accepts
 * (git-check-ref-format): no separators, whitespace or ref syntax, no leading `.` or `-`, no
 * trailing `.` or `.lock`.
 */
const REFUSED = /[\s~^:?*[\\/]|\p{Cc}|\.\.|@\{/u;

export const isReleasableName = (publication: string): boolean =>
  publication !== '' &&
  !REFUSED.test(publication) &&
  !publication.startsWith('.') &&
  !publication.startsWith('-') &&
  !publication.endsWith('.') &&
  !publication.endsWith('.lock');
