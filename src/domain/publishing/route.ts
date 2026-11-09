import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';
import { renderTemplate } from '../template/render.js';
import { slugify } from '../note/note.js';

/*
 * A route is the public URL path an entry is published at — the single source of truth for both
 * its on-disk output path and the links other entries point at it with. Everything here is pure
 * string work over POSIX paths and URL segments.
 */

/** The pieces of a candidate a route template may reference. */
export interface RouteInput {
  readonly path: string;
  readonly title: string;
  readonly slug?: string;
  readonly id: string;
  readonly type?: string;
}

export interface RouteVariables {
  readonly slug: string;
  readonly id: string;
  readonly dir: string;
  readonly stem: string;
  readonly type?: string;
}

/** The slug is the frontmatter `slug` when set, else the title slugified. */
export const routeVariables = (input: RouteInput): RouteVariables => {
  const slug =
    input.slug !== undefined && input.slug.trim() !== '' ? input.slug : slugify(input.title);
  const parts = input.path.split('/').filter((segment) => segment !== '');
  const file = parts[parts.length - 1] ?? input.path;
  const dir = parts.slice(0, -1).join('/');
  const stem = file.replace(/\.[^.]+$/, '');
  return input.type !== undefined
    ? { slug, id: input.id, dir, stem, type: input.type }
    : { slug, id: input.id, dir, stem };
};

/**
 * Canonicalizes a route: a single leading `/`, collapsed slashes, a preserved trailing `/`, and
 * every character outside the RFC 3986 unreserved set percent-encoded. A `.` or `..` segment is
 * rejected — a route is a URL path, not a filesystem path, and those would let a hostile `slug`
 * escape.
 */
export const normalizeRoute = (route: string): Result<string, AppError> => {
  const text = route.replace(/\\/g, '/');
  const segments = text.split('/').filter((segment) => segment !== '');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      return err(validation('Route must not contain "." or ".." segments', { route }));
    }
  }
  const encoded = segments.map((segment) =>
    segment.replace(/[^A-Za-z0-9\-._~]/gu, (char) => encodeURIComponent(char)),
  );
  if (encoded.length === 0) return ok('/');
  const trailing = text.endsWith('/') ? '/' : '';
  return ok(`/${encoded.join('/')}${trailing}`);
};

/**
 * Fills a route template and canonicalizes the result. A placeholder the candidate cannot supply
 * (`{{type}}` on a typeless entry) surfaces as the template renderer's `validation`; the caller
 * names the offending entry.
 */
export const renderRoute = (template: string, vars: RouteVariables): Result<string, AppError> => {
  const record: Record<string, string> = {
    slug: vars.slug,
    id: vars.id,
    dir: vars.dir,
    stem: vars.stem,
  };
  if (vars.type !== undefined) record.type = vars.type;
  const rendered = renderTemplate(template, record);
  return rendered.ok ? normalizeRoute(rendered.value) : rendered;
};

export type Layout = 'flat' | 'directory';

/**
 * Maps a route to an output file path. `flat` writes `a/b.<ext>`; `directory` writes
 * `a/b/index.<ext>` (so a server serves it at the route with a trailing slash). The root route
 * `/` becomes `index.<ext>` under either layout.
 */
export const routeToPath = (route: string, ext: string, layout: Layout): string => {
  const segments = route.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) return `index.${ext}`;
  return layout === 'directory'
    ? `${segments.join('/')}/index.${ext}`
    : `${segments.join('/')}.${ext}`;
};
