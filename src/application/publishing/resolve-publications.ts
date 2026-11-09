import { validation, type AppError } from '../../domain/errors.js';
import { DEFAULT_ROUTE, type Publication } from '../../domain/publishing/publication.js';
import { err, ok, type Result } from '../../domain/result.js';
import { availableVaults, type Scope } from '../../domain/scope/scope.js';
import type { Destination, ResolvedPublication } from './destination.js';
import { validateOptions } from './validate-options.js';

/*
 * Turns every available vault's declared publications into resolved ones: the destination kind
 * found, its options validated, and the route reconciled with any route the destination fixes.
 * A failure here fails the registry build — a broken `publications:` block blocks the vault from
 * opening, exactly as invalid plugin settings do.
 */

export const resolvePublications = (
  scope: Scope,
  destinationsFor: (root: string) => readonly Destination[],
): Result<ResolvedPublication[], AppError> => {
  const resolved: ResolvedPublication[] = [];
  for (const vault of availableVaults(scope)) {
    const destinations = destinationsFor(vault.root);
    for (const publication of Object.values(vault.config.publications ?? {})) {
      const { kind } = publication.destination;
      const destination = destinations.find((d) => d.kind === kind);
      if (!destination) {
        return err(
          validation(
            `Publication "${publication.name}" in ${vault.config.name} uses unknown destination "${kind}"`,
            {
              vault: vault.config.name,
              publication: publication.name,
              kind,
              known: destinations.map((d) => d.kind),
            },
          ),
        );
      }
      const options = validateOptions(destination, publication.destination.options);
      if (!options.ok) {
        return err(
          validation(
            `Publication "${publication.name}" in ${vault.config.name}: ${options.error.message}`,
            { vault: vault.config.name, publication: publication.name, kind },
          ),
        );
      }
      const route = reconcileRoute(publication, destination, options.value);
      if (!route.ok) return route;
      resolved.push({
        vault,
        publication:
          route.value === publication.route ? publication : { ...publication, route: route.value },
        destination,
        options: options.value,
      });
    }
  }
  return ok(resolved);
};

/** The effective route: the destination's fixed route wins over the default, and fights an override. */
const reconcileRoute = (
  publication: Publication,
  destination: Destination,
  options: unknown,
): Result<string, AppError> => {
  const fixed = destination.fixedRoute?.(options);
  if (fixed === undefined || fixed === publication.route) return ok(publication.route);
  if (publication.route === DEFAULT_ROUTE) return ok(fixed);
  return err(
    validation(
      `Publication "${publication.name}" sets route "${publication.route}", but destination "${destination.kind}" fixes it to "${fixed}"`,
      { publication: publication.name, route: publication.route, fixed },
    ),
  );
};
