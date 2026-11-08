import { buildPlan, isPublishable } from '../../domain/publishing/plan.js';
import { resolveOutputDir } from '../../domain/publishing/output-path.js';
import { selectCandidates } from '../../domain/publishing/select.js';
import type { Finding } from '../doctor/diagnose.js';
import type { PluginRegistry } from '../plugin/plugin.js';
import { validateFields } from '../plugin/validate-fields.js';
import type { OpenedVault } from '../scope/session.js';
import { collectCandidates } from './candidates.js';

/*
 * Doctor's pre-flight for publications. For each resolved publication whose vault is open it
 * selects the eligible notes and checks them against the destination's declared source fields
 * (dropping `undeclared` — a note may carry anything), then plans the publication and reports any
 * collision or policy violation as a warning. Doctor only warns; `publish` is the real gate.
 */
export const publicationFindings = (
  registry: PluginRegistry,
  opened: readonly OpenedVault[],
): Finding[] => {
  const findings: Finding[] = [];
  const openRoots = new Set(opened.map((o) => o.vault.root));
  const { candidates, existing } = collectCandidates(opened);
  for (const { publication, destination, options, vault } of registry.publications()) {
    if (!openRoots.has(vault.root)) continue;
    const name = vault.config.name;
    const { included } = selectCandidates(publication, candidates, name);
    const specs = destination.fields(options);
    for (const candidate of included) {
      for (const issue of validateFields(specs, candidate.fields)) {
        if (issue.problem === 'undeclared') continue;
        findings.push({
          kind: 'publication',
          severity: 'warning',
          vault: name,
          message: `${candidate.path} → ${publication.name} (${destination.kind}): ${issue.message}`,
          details: {
            publication: publication.name,
            destination: destination.kind,
            path: candidate.path,
            field: issue.field,
            problem: issue.problem,
          },
        });
      }
    }
    const outputDir = resolveOutputDir(vault.root, publication.output);
    const plan = buildPlan(publication, name, outputDir, candidates, existing);
    if (!plan.ok) {
      findings.push({
        kind: 'publication',
        severity: 'warning',
        vault: name,
        message: `publication "${publication.name}" cannot be planned: ${plan.error.message}`,
        details: { publication: publication.name },
      });
      continue;
    }
    if (!isPublishable(plan.value)) {
      const violation = plan.value.violations[0];
      const collision = plan.value.collisions[0];
      const detail = violation
        ? `${violation.source.path} references ${violation.target} (${violation.state})`
        : collision
          ? `route ${collision.key} is claimed by ${collision.ids.join(', ')}`
          : 'it has violations';
      findings.push({
        kind: 'publication',
        severity: 'warning',
        vault: name,
        message: `publication "${publication.name}" would not proceed: ${detail}`,
        details: {
          publication: publication.name,
          violations: plan.value.violations.length,
          collisions: plan.value.collisions.length,
        },
      });
    }
  }
  return findings;
};
