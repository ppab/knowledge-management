import { asEntryId } from '../../domain/entry/entry-id.js';
import { isEntrySummary } from '../../domain/entry/summary.js';
import type { Reference } from '../../domain/reference/reference.js';
import type { PublicationCandidate } from '../../domain/publishing/select.js';
import type { OpenedVault } from '../scope/session.js';

/*
 * Builds the candidate set every publication is planned from: one `PublicationCandidate` per
 * identified note across the open vaults, plus the title of every note (for reference label
 * fallbacks and excluded/unresolved classification). Entirely from the index — no file reads —
 * so planning and dry-run never open a note.
 */

export interface CandidateSet {
  readonly candidates: readonly PublicationCandidate[];
  readonly existing: ReadonlyMap<string, { readonly title: string }>;
}

export const collectCandidates = (opened: readonly OpenedVault[]): CandidateSet => {
  const candidates: PublicationCandidate[] = [];
  const existing = new Map<string, { title: string }>();
  for (const vaultOpened of opened) {
    const vault = vaultOpened.vault.config.name;
    for (const summary of vaultOpened.index.all()) {
      if (!isEntrySummary(summary)) continue;
      existing.set(summary.id, { title: summary.title });
      const references: Reference[] = vaultOpened.index.outgoing(summary.path).map((reference) => ({
        target: asEntryId(reference.target),
        ...(reference.label !== undefined && { label: reference.label }),
        range: reference.range,
      }));
      candidates.push({
        vault,
        path: summary.path,
        id: summary.id,
        title: summary.title,
        ...(summary.slug !== undefined && { slug: summary.slug }),
        ...(summary.type !== undefined && { type: summary.type }),
        visibility: summary.visibility,
        tags: summary.tags,
        dates: summary.dates,
        fields: summary.fields,
        version: summary.version,
        references,
      });
    }
  }
  return { candidates, existing };
};
