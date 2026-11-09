import { err, ok, type Result } from '../result.js';
import { validation, type AppError } from '../errors.js';
import { renderRoute, routeVariables } from './route.js';
import { classifyReferences, type Classification } from './classify.js';
import { findRouteCollisions, type Collision } from './collisions.js';
import { selectCandidates, type PublicationCandidate, type Selection } from './select.js';
import type { Publication } from './publication.js';

/*
 * The plan is the whole publication decided before anything is written: which entries are
 * emitted and at what route, which are excluded and why, how every reference resolves, and any
 * route collision. It is pure and destination-agnostic — the destination later decides file
 * layout and rendering. Only a plan with no violations and no collisions may proceed.
 */

export interface PlanEntry extends PublicationCandidate {
  readonly route: string;
}

export interface PublicationPlan {
  readonly publication: Publication;
  readonly vault: string;
  readonly outputDir: string;
  readonly entries: readonly PlanEntry[];
  readonly excluded: Selection['excluded'];
  readonly targets: Classification['targets'];
  readonly violations: Classification['violations'];
  readonly collisions: readonly Collision[];
}

export const buildPlan = (
  publication: Publication,
  definingVault: string,
  outputDir: string,
  candidates: readonly PublicationCandidate[],
  existing: ReadonlyMap<string, { readonly title: string }>,
): Result<PublicationPlan, AppError> => {
  const { included, excluded } = selectCandidates(publication, candidates, definingVault);
  const entries: PlanEntry[] = [];
  for (const candidate of included) {
    const route = renderRoute(publication.route, routeVariables(candidate));
    if (!route.ok) {
      return err(
        validation(`Cannot build a route for ${candidate.path}: ${route.error.message}`, {
          path: candidate.path,
          id: candidate.id,
        }),
      );
    }
    entries.push({ ...candidate, route: route.value });
  }
  entries.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  const { targets, violations } = classifyReferences(included, existing, publication.references);
  return ok({
    publication,
    vault: definingVault,
    outputDir,
    entries,
    excluded,
    targets,
    violations,
    collisions: findRouteCollisions(entries),
  });
};

export const isPublishable = (plan: PublicationPlan): boolean =>
  plan.violations.length === 0 && plan.collisions.length === 0;
