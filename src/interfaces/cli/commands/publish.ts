import type { Command } from 'commander';
import { isPublishable } from '../../../domain/publishing/plan.js';
import type { ExclusionReason } from '../../../domain/publishing/select.js';
import { ok } from '../../../domain/result.js';
import type { ResolvedPublication } from '../../../application/publishing/destination.js';
import {
  listPublications,
  publish,
  type PublishOutcome,
} from '../../../application/publishing/publish.js';
import type { Exit } from '../commands.js';
import { contextFor, inScopeWithPlugins, type CliIo } from '../context.js';
import { emit, EXIT_CODES, table } from '../output.js';

/*
 * `publish [name] [--dry-run]`. With no name it lists the scope's publications; with a name it
 * plans the publication and (unless --dry-run) writes it. A dry run that is not publishable
 * exits 6, matching a real run's refusal, so a check in CI is one command either way.
 */

const reasonText = (reason: ExclusionReason): string => {
  switch (reason.kind) {
    case 'vault':
      return 'other vault';
    case 'private':
      return 'private';
    case 'not-included':
      return 'not included';
    case 'excluded':
      return `excluded by ${reason.by}`;
  }
};

const header = (resolved: ResolvedPublication, outputDir: string): string =>
  `publication: ${resolved.publication.name} (${resolved.vault.config.name}, ${resolved.destination.kind}) → ${outputDir}`;

const publishText = (outcome: PublishOutcome): string => {
  const { resolved, plan } = outcome;
  const { destination, options } = resolved;
  const lines = [header(resolved, plan.outputDir)];
  if (outcome.kind === 'published') {
    lines.push(
      `Wrote ${String(outcome.report.files.length)} file(s) to ${outcome.report.outputDir}:`,
    );
    lines.push(...outcome.report.files.map((f) => `  ${f}`));
    return lines.join('\n');
  }
  lines.push(`included (${String(plan.entries.length)}):`);
  lines.push(
    table(
      plan.entries.map((e) => [
        `  ${e.id}`,
        e.title,
        e.path,
        e.route,
        destination.pathFor(e, options),
      ]),
    ),
  );
  if (plan.excluded.length > 0) {
    lines.push(`excluded (${String(plan.excluded.length)}):`);
    lines.push(
      table(
        plan.excluded.map((x) => [`  ${x.candidate.id}`, x.candidate.path, reasonText(x.reason)]),
      ),
    );
  }
  if (plan.violations.length > 0) {
    lines.push(`violations (${String(plan.violations.length)}):`);
    lines.push(
      ...plan.violations.map(
        (v) =>
          `  ${v.source.path} [[${v.target}]] → ${v.target} (${v.state}; policy ${plan.publication.references})`,
      ),
    );
  }
  if (plan.collisions.length > 0) {
    lines.push('collisions:');
    lines.push(...plan.collisions.map((c) => `  ${c.key}: ${c.ids.join(', ')}`));
  }
  if (isPublishable(plan)) lines.push('(publishable)');
  return lines.join('\n');
};

const publishJson = (outcome: PublishOutcome): unknown => {
  const { resolved, plan } = outcome;
  const base = {
    publication: resolved.publication.name,
    vault: resolved.vault.config.name,
    destination: resolved.destination.kind,
    outputDir: plan.outputDir,
    included: plan.entries.map((e) => ({
      id: e.id,
      title: e.title,
      source: e.path,
      route: e.route,
      path: resolved.destination.pathFor(e, resolved.options),
    })),
    excluded: plan.excluded.map((x) => ({
      id: x.candidate.id,
      path: x.candidate.path,
      reason: x.reason,
    })),
    violations: plan.violations,
    collisions: plan.collisions,
    publishable: isPublishable(plan),
  };
  return outcome.kind === 'published' ? { ...base, written: outcome.report.files } : base;
};

const listText = (publications: readonly ResolvedPublication[]): string =>
  publications.length === 0
    ? 'No publications defined in .notes/config.yaml'
    : table([
        ['name', 'vault', 'kind', 'output', 'route'],
        ...publications.map((p) => [
          p.publication.name,
          p.vault.config.name,
          p.destination.kind,
          p.publication.output,
          p.publication.route,
        ]),
      ]);

export const registerPublishCommand = (program: Command, io: CliIo, exit: Exit): void => {
  program
    .command('publish')
    .description('write a selected set of entries to a configured publication')
    .argument('[name]', 'the publication to write; omit to list the configured publications')
    .option('--dry-run', 'print the publication plan and write nothing')
    .action(async (name: string | undefined, options: { dryRun?: boolean }, cmd: Command) => {
      const ctx = contextFor(io, cmd);
      if (name === undefined) {
        exit(
          await emit(
            ctx,
            inScopeWithPlugins(ctx, (_scope, registry) =>
              Promise.resolve(ok(listPublications(registry))),
            ),
            listText,
            (publications) =>
              publications.map((p) => ({
                name: p.publication.name,
                vault: p.vault.config.name,
                kind: p.destination.kind,
                output: p.publication.output,
                route: p.publication.route,
              })),
          ),
        );
        return;
      }
      const state = { unpublishable: false };
      const code = await emit(
        ctx,
        inScopeWithPlugins(ctx, (scope, registry) =>
          publish(ctx.deps, scope, registry, { name, dryRun: options.dryRun ?? false }),
        ),
        (outcome) => {
          if (outcome.kind === 'planned' && !isPublishable(outcome.plan))
            state.unpublishable = true;
          return publishText(outcome);
        },
        publishJson,
      );
      exit(code === 0 && state.unpublishable ? EXIT_CODES.VALIDATION : code);
    });
};
