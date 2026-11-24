import { unavailable, usage, validation, type AppError } from '../../domain/errors.js';
import { isReleasableName, releaseTagName } from '../../domain/release/release-tag.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { PluginRegistry } from '../plugin/plugin.js';
import type { AppDeps } from '../ports.js';
import type { ResolvedPublication } from '../publishing/destination.js';
import { findPublication } from '../publishing/publish.js';
import { withScope } from '../scope/session.js';

/*
 * The `release` use case. It marks the checked-out commit of the repository holding the
 * publication's vault with an annotated tag `release/<publication>/<UTC stamp>` and pushes that
 * tag. It publishes nothing itself: whatever watches the repository for `release/**` tags runs
 * `publish` on the tagged commit. Everything that can refuse — an unknown publication, no
 * repository, no usable remote — refuses before the tag exists, so a failed release leaves
 * nothing behind; only a failed push leaves the tag, and says how to send it.
 */

export interface ReleaseInput {
  /** The publication to release. */
  readonly name: string;
  /** Push the tag after creating it (default: true). */
  readonly push?: boolean;
  /** The remote to push to; default: the only remote, else `origin`. */
  readonly remote?: string;
  /** Report the tag that would be created; create and push nothing. */
  readonly dryRun?: boolean;
}

export interface ReleaseOutcome {
  /** `planned`: a dry run; `tagged`: created, not pushed (`push: false`); `released`: pushed. */
  readonly kind: 'planned' | 'tagged' | 'released';
  readonly resolved: ResolvedPublication;
  readonly tag: string;
  readonly commit: string;
  /** The vault has changes the tagged commit does not hold. */
  readonly uncommitted: boolean;
  /** Where the tag was (or would be) pushed; absent when not pushing. */
  readonly remote?: string;
}

export const DEFAULT_REMOTE = 'origin';

const chooseRemote = (remotes: readonly string[], wanted?: string): Result<string, AppError> => {
  if (wanted !== undefined) {
    return remotes.includes(wanted)
      ? ok(wanted)
      : err(
          usage(
            `No remote "${wanted}"${remotes.length > 0 ? `; configured: ${remotes.join(', ')}` : ' is configured'}`,
            { remotes },
          ),
        );
  }
  const [only] = remotes;
  if (only === undefined) {
    return err(
      usage('The repository has no remote to push the release to; use --no-push to tag only'),
    );
  }
  if (remotes.length === 1) return ok(only);
  return remotes.includes(DEFAULT_REMOTE)
    ? ok(DEFAULT_REMOTE)
    : err(
        usage(`Several remotes and no "${DEFAULT_REMOTE}"; choose one with --remote`, { remotes }),
      );
};

export const release = (
  deps: AppDeps,
  scope: Scope,
  registry: PluginRegistry,
  input: ReleaseInput,
): Promise<Result<ReleaseOutcome, AppError>> =>
  withScope<ReleaseOutcome>(deps, scope, async (session) => {
    const found = findPublication(registry, session, input.name);
    if (!found.ok) return found;
    const resolved = found.value;
    if (!isReleasableName(input.name)) {
      return err(validation(`Publication name "${input.name}" cannot be part of a tag name`));
    }
    const root = resolved.vault.root;
    const head = await deps.releases.head(root);
    if (!head.ok) return head;
    if (head.value === null) {
      return err(unavailable(`${root} is not under version control`, { root }));
    }
    const { commit, uncommitted } = head.value;

    let remote: string | undefined;
    if (input.push !== false) {
      const remotes = await deps.releases.remotes(root);
      if (!remotes.ok) return remotes;
      const chosen = chooseRemote(remotes.value, input.remote);
      if (!chosen.ok) return chosen;
      remote = chosen.value;
    }

    const tag = releaseTagName(input.name, deps.clock.now());
    const base = { resolved, tag, commit, uncommitted, ...(remote !== undefined && { remote }) };
    if (input.dryRun) return ok({ kind: 'planned', ...base });

    const tagged = await deps.releases.tag(root, tag, `Release ${input.name}`);
    if (!tagged.ok) return tagged;
    if (remote === undefined) return ok({ kind: 'tagged', ...base });

    const pushed = await deps.releases.push(root, remote, tag);
    if (!pushed.ok) {
      return err({
        ...pushed.error,
        message: `${pushed.error.message}\nThe tag exists locally; send it with: git push ${remote} ${tag}`,
        details: { ...pushed.error.details, tag, remote },
      });
    }
    return ok({ kind: 'released', ...base });
  });
