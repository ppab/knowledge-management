import type { VaultConfig } from './vault.js';

/*
 * A small glob matcher for vault-relative POSIX paths, so the application layer can decide
 * whether a path falls under `include`/`exclude` without a filesystem or a glob library.
 * It follows the conventions of the indexer's globbing: `**` spans directories, `*` and `?`
 * stay within one segment, `[...]` and `{a,b}` are supported, and no wildcard matches a segment
 * that starts with a dot (so `.notes/`, `.git/` and friends stay invisible).
 */

const escape = (char: string): string => char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Regex source for one glob segment (no `/` inside). */
const segmentSource = (segment: string): string => {
  let source = '';
  let i = 0;
  while (i < segment.length) {
    const char = segment.charAt(i);
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const end = segment.indexOf(']', i + 1);
      if (end === -1) {
        source += '\\[';
      } else {
        const body = segment
          .slice(i + 1, end)
          .replace(/^!/, '^')
          .replace(/\\/g, '\\\\');
        source += `[${body}]`;
        i = end;
      }
    } else if (char === '{') {
      const end = segment.indexOf('}', i + 1);
      if (end === -1) {
        source += '\\{';
      } else {
        const alternatives = segment
          .slice(i + 1, end)
          .split(',')
          .map(segmentSource);
        source += `(?:${alternatives.join('|')})`;
        i = end;
      }
    } else {
      source += escape(char);
    }
    i += 1;
  }
  return source;
};

const compiled = new Map<string, RegExp>();

const segmentMatcher = (segment: string): RegExp => {
  let regex = compiled.get(segment);
  if (regex === undefined) {
    regex = new RegExp(`^${segmentSource(segment)}$`);
    compiled.set(segment, regex);
  }
  return regex;
};

const matchSegment = (pattern: string, segment: string): boolean =>
  (!segment.startsWith('.') || pattern.startsWith('.')) && segmentMatcher(pattern).test(segment);

const matchFrom = (
  patterns: readonly string[],
  p: number,
  parts: readonly string[],
  s: number,
): boolean => {
  while (p < patterns.length) {
    const pattern = patterns[p] ?? '';
    if (pattern === '**') {
      // Zero or more segments, none hidden. Try the rest of the pattern at every position.
      for (let k = s; k <= parts.length; k += 1) {
        if (matchFrom(patterns, p + 1, parts, k)) return true;
        if (k < parts.length && (parts[k] ?? '').startsWith('.')) return false;
      }
      return false;
    }
    if (s >= parts.length || !matchSegment(pattern, parts[s] ?? '')) return false;
    p += 1;
    s += 1;
  }
  return s === parts.length;
};

/** Whether a normalized vault-relative file path matches a glob. */
export const matchesGlob = (glob: string, path: string): boolean => {
  const patterns = glob
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  const parts = path.split('/').filter((segment) => segment !== '');
  return matchFrom(patterns, 0, parts, 0);
};

export type Inclusion =
  | { readonly kind: 'included' }
  | { readonly kind: 'not-included'; readonly include: readonly string[] }
  | { readonly kind: 'excluded'; readonly by: string };

/** Whether the vault would index a file at this path: some `include` matches, no `exclude` does. */
export const inclusionOf = (
  config: Pick<VaultConfig, 'include' | 'exclude'>,
  path: string,
): Inclusion => {
  if (!config.include.some((glob) => matchesGlob(glob, path))) {
    return { kind: 'not-included', include: config.include };
  }
  const by = config.exclude.find((glob) => matchesGlob(glob, path));
  return by === undefined ? { kind: 'included' } : { kind: 'excluded', by };
};
