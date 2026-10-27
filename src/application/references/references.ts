import type { AppError } from '../../domain/errors.js';
import type { EntrySummary, NoteSummary } from '../../domain/note/summary.js';
import { ok, type Result } from '../../domain/result.js';
import type { SourceRange } from '../../domain/text/text-edit.js';
import { withFreshIndex } from '../index/refresh-index.js';
import { resolveEntry } from '../notes/resolve-entry.js';
import type { AppDeps, NoteIndex } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';

export type Resolution =
  | { readonly state: 'resolved'; readonly note: NoteSummary }
  | { readonly state: 'ambiguous'; readonly paths: readonly string[] }
  | { readonly state: 'unresolved' };

export interface OutgoingReference {
  readonly target: string;
  readonly label?: string;
  readonly range: SourceRange;
  readonly resolution: Resolution;
}

export interface ReferenceListing {
  readonly source: NoteSummary;
  readonly references: readonly OutgoingReference[];
}

const resolveTarget = (index: NoteIndex, target: string): Resolution => {
  const matches = index.byId(target);
  const [first, second] = matches;
  if (second) return { state: 'ambiguous', paths: matches.map((m) => m.path) };
  if (first) return { state: 'resolved', note: first };
  return { state: 'unresolved' };
};

/** Every `[[…]]` in a note, as stored in the index, with where each one leads. */
export const listReferences = (
  deps: AppDeps,
  vault: VaultHandle,
  query: string,
): Promise<Result<ReferenceListing, AppError>> =>
  withFreshIndex(deps, vault, (index) => {
    const source = resolveEntry(index, query);
    if (!source.ok) return source;
    const references = index.outgoing(source.value.path).map((ref) => ({
      target: ref.target,
      ...(ref.label !== undefined && { label: ref.label }),
      range: ref.range,
      resolution: resolveTarget(index, ref.target),
    }));
    return ok({ source: source.value, references });
  });

export interface Backlink {
  readonly source: EntrySummary;
  readonly label?: string;
  readonly range: SourceRange;
}

export interface BacklinkListing {
  readonly target: NoteSummary;
  readonly backlinks: readonly Backlink[];
}

/** Notes (identified or not) whose references target the resolved note's id. */
export const backlinks = (
  deps: AppDeps,
  vault: VaultHandle,
  query: string,
): Promise<Result<BacklinkListing, AppError>> =>
  withFreshIndex(deps, vault, (index) => {
    const target = resolveEntry(index, query);
    if (!target.ok) return target;
    const links: Backlink[] = [];
    for (const ref of index.backlinks(target.value.id)) {
      const source = index.byPath(ref.sourcePath);
      if (!source) continue;
      links.push({
        source,
        ...(ref.label !== undefined && { label: ref.label }),
        range: ref.range,
      });
    }
    return ok({ target: target.value, backlinks: links });
  });
