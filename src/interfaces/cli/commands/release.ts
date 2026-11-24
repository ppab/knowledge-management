import type { Command } from 'commander';
import { release, type ReleaseOutcome } from '../../../application/release/release.js';
import { abbreviate } from '../../../domain/revision/revision.js';
import type { Exit } from '../commands.js';
import { contextFor, inScopeWithPlugins, type CliIo } from '../context.js';
import { emit } from '../output.js';

/*
 * `release <name> [--no-push] [--remote <r>] [--dry-run]`. Tags the checked-out commit as a
 * release of the publication and pushes the tag; publishing is left to whatever watches the
 * repository for `release/**` tags.
 */

const releaseText = (outcome: ReleaseOutcome): string => {
  const { tag, remote } = outcome;
  const at = `at ${abbreviate(outcome.commit)}`;
  const lines: string[] = [];
  switch (outcome.kind) {
    case 'planned':
      lines.push(
        `Would tag ${tag} ${at}${remote === undefined ? '' : ` and push it to ${remote}`}`,
      );
      break;
    case 'tagged':
      lines.push(`Tagged ${tag} ${at} (not pushed)`);
      break;
    case 'released':
      lines.push(`Released ${tag} ${at}, pushed to ${remote ?? ''}`);
      break;
  }
  if (outcome.uncommitted) {
    lines.push(
      `note: ${outcome.resolved.vault.config.name} has uncommitted changes; they are not part of this release`,
    );
  }
  return lines.join('\n');
};

export const registerReleaseCommand = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('release')
    .description('tag the current commit as a release of a publication and push the tag')
    .argument('<name>', 'the publication to release')
    .option('--no-push', 'create the tag and leave it local')
    .option(
      '--remote <remote>',
      'remote to push the tag to (default: the only remote, else origin)',
    )
    .option('--dry-run', 'print the tag that would be created; create and push nothing')
    .action(
      async (
        name: string,
        options: { push: boolean; remote?: string; dryRun?: boolean },
        cmd: Command,
      ) => {
        const ctx = contextFor(io, cmd);
        exit(
          await emit(
            ctx,
            inScopeWithPlugins(ctx, (scope, registry) =>
              release(ctx.deps, scope, registry, {
                name,
                push: options.push,
                ...(options.remote !== undefined && { remote: options.remote }),
                dryRun: options.dryRun ?? false,
              }),
            ),
            releaseText,
            (outcome) => ({
              publication: outcome.resolved.publication.name,
              vault: outcome.resolved.vault.config.name,
              status: outcome.kind,
              tag: outcome.tag,
              commit: outcome.commit,
              ...(outcome.remote !== undefined && { remote: outcome.remote }),
              uncommitted: outcome.uncommitted,
            }),
          ),
        );
      },
    );
};
