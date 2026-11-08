import { ambiguous, notFound, unavailable, usage, validation, type AppError } from '../../domain/errors.js';
import { isPublishable, type PublicationPlan } from '../../domain/publishing/plan.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { PluginRegistry } from '../plugin/plugin.js';
import type { AppDeps } from '../ports.js';
import { withScope, type ScopeSession } from '../scope/session.js';
import type { ResolvedPublication } from './destination.js';
import { executePublication, type PublishReport } from './execute-publication.js';
import { planPublication } from './plan-publication.js';

/*
 * The `publish` use case. It resolves a publication by name across the scope, plans it from the
 * index, and — unless this is a dry run — writes it. A dry run always succeeds with the plan
 * (the interface decides how to signal an unpublishable one); a real run of an unpublishable plan
 * fails, naming the first violation, and writes nothing.
 */

export interface PublishInput {
  readonly name: string;
  readonly dryRun?: boolean;
}

export type PublishOutcome =
  | { readonly kind: 'planned'; readonly resolved: ResolvedPublication; readonly plan: PublicationPlan }
  | {
      readonly kind: 'published';
      readonly resolved: ResolvedPublication;
      readonly plan: PublicationPlan;
      readonly report: PublishReport;
    };

/** Every resolved publication in the registry, for the bare `publish` listing. */
export const listPublications = (registry: PluginRegistry): readonly ResolvedPublication[] =>
  registry.publications();

const findPublication = (
  registry: PluginRegistry,
  session: ScopeSession,
  name: string,
): Result<ResolvedPublication, AppError> => {
  const matches = registry.publications().filter((p) => p.publication.name === name);
  if (matches.length === 0) {
    const names = registry.publications().map((p) => p.publication.name);
    const message = `No publication "${name}"${names.length > 0 ? `; defined: ${names.join(', ')}` : ' is defined'}`;
    // A missing match while vaults are unavailable might only be a vault we could not open (A6).
    return err(session.unavailable.length > 0 ? unavailable(message, { names }) : notFound(message, { names }));
  }
  if (matches.length > 1) {
    return err(
      ambiguous(`Publication "${name}" is defined in ${matches.length} vaults`, {
        vaults: matches.map((m) => m.vault.config.name),
      }),
    );
  }
  const resolved = matches[0] as ResolvedPublication;
  if (resolved.publication.vaults) {
    const names = new Set(session.opened.map((o) => o.vault.config.name));
    const missing = resolved.publication.vaults.filter((v) => !names.has(v));
    if (missing.length > 0) {
      return err(
        usage(`Publication "${name}" draws from vault(s) not in scope: ${missing.join(', ')}`, {
          missing,
        }),
      );
    }
  }
  return ok(resolved);
};

export const publish = (
  deps: AppDeps,
  scope: Scope,
  registry: PluginRegistry,
  input: PublishInput,
): Promise<Result<PublishOutcome, AppError>> =>
  withScope<PublishOutcome>(deps, scope, async (session) => {
    const found = findPublication(registry, session, input.name);
    if (!found.ok) return found;
    const resolved = found.value;
    const plan = planPublication(session, resolved);
    if (!plan.ok) return plan;
    if (input.dryRun) return ok({ kind: 'planned', resolved, plan: plan.value });
    if (!isPublishable(plan.value)) {
      const violation = plan.value.violations[0];
      const collision = plan.value.collisions[0];
      const detail = violation
        ? `${violation.source.path} [[${violation.target}]] → ${violation.target} (${violation.state}; policy fail)`
        : collision
          ? `route ${collision.key} is claimed by ${collision.ids.join(', ')}`
          : 'the plan has violations';
      return err(
        validation(`Publication "${input.name}" cannot proceed: ${detail}`, {
          violations: plan.value.violations,
          collisions: plan.value.collisions,
        }),
      );
    }
    const report = await executePublication(deps, session, resolved, plan.value);
    if (!report.ok) return report;
    return ok({ kind: 'published', resolved, plan: plan.value, report: report.value });
  });
