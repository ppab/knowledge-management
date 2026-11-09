import { validation, type AppError } from '../../domain/errors.js';
import { resolveOutputDir } from '../../domain/publishing/output-path.js';
import { buildPlan, type PublicationPlan } from '../../domain/publishing/plan.js';
import type { Result } from '../../domain/result.js';
import { err } from '../../domain/result.js';
import { inclusionOf } from '../../domain/vault/glob.js';
import { collectCandidates } from './candidates.js';
import type { ResolvedPublication } from './destination.js';
import type { ScopeSession } from '../scope/session.js';

/*
 * Plans one resolved publication from the session's index data. Pure except for the output-dir
 * guard: if the output lands inside the defining vault where the vault would index it, the next
 * refresh would ingest the published copies as duplicate-id notes, so the publication is refused.
 */

/** The vault-relative directory of `dir` when it is inside `root`, else `null`. */
const insideVault = (root: string, dir: string): string | null => {
  const base = root.replace(/\/+$/, '');
  if (dir === base) return '';
  return dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : null;
};

export const planPublication = (
  session: ScopeSession,
  resolved: ResolvedPublication,
): Result<PublicationPlan, AppError> => {
  const { vault, publication } = resolved;
  const outputDir = resolveOutputDir(vault.root, publication.output);
  const relative = insideVault(vault.root, outputDir);
  if (relative !== null) {
    const probe = relative === '' ? 'probe.md' : `${relative}/probe.md`;
    if (inclusionOf(vault.config, probe).kind === 'included') {
      return err(
        validation(
          `Publication "${publication.name}" writes to ${publication.output}, which this vault indexes; add it to the vault's exclude globs`,
          { publication: publication.name, output: publication.output },
        ),
      );
    }
  }
  const { candidates, existing } = collectCandidates(session.opened);
  return buildPlan(publication, vault.config.name, outputDir, candidates, existing);
};
