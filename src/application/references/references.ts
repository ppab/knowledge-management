import type { AppError } from '../../domain/errors.js';
import type { EntrySummary, NoteSummary } from '../../domain/note/summary.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { SourceRange } from '../../domain/text/text-edit.js';
import type { AppDeps } from '../ports.js';
import {
  resolveIdInScope,
  resolveInScope,
  withScope,
  type ScopeSession,
} from '../scope/session.js';

export type Resolution =
  | { readonly state: 'resolved'; readonly vault: string; readonly note: NoteSummary }
  | {
      readonly state: 'ambiguous';
      readonly candidates: readonly { readonly vault: string; readonly path: string }[];
    }
  | { readonly state: 'unavailable'; readonly vaults: readonly string[] }
  | { readonly state: 'unresolved' };

export interface OutgoingReference {
  readonly target: string;
  readonly label?: string;
  readonly range: SourceRange;
  readonly resolution: Resolution;
}

export interface ReferenceListing {
  readonly vault: string;
  readonly source: NoteSummary;
  readonly references: readonly OutgoingReference[];
}

/** Where a reference target (an id) leads within the session's scope. */
export const resolveTarget = (session: ScopeSession, target: string): Resolution => {
  const result = resolveIdInScope(session, target);
  switch (result.state) {
    case 'resolved': {
      const { opened: _opened, ...note } = result.match.note;
      return { state: 'resolved', vault: result.match.vault, note };
    }
    case 'ambiguous':
      return {
        state: 'ambiguous',
        candidates: result.candidates.map((c) => ({ vault: c.vault, path: c.note.path })),
      };
    case 'unavailable':
      return { state: 'unavailable', vaults: result.vaults };
    case 'not-found':
      return { state: 'unresolved' };
  }
};

/** Every `[[…]]` a note makes, as stored in its index, with where each one leads in the scope. */
export const listReferences = (
  deps: AppDeps,
  scope: Scope,
  query: string,
): Promise<Result<ReferenceListing, AppError>> =>
  withScope(deps, scope, (session) => {
    const source = resolveInScope(session, query);
    if (!source.ok) return source;
    const { opened, summary } = source.value;
    const references = opened.index.outgoing(summary.path).map((ref) => ({
      target: ref.target,
      ...(ref.label !== undefined && { label: ref.label }),
      range: ref.range,
      resolution: resolveTarget(session, ref.target),
    }));
    return ok({ vault: opened.vault.config.name, source: summary, references });
  });

export interface Backlink {
  readonly vault: string;
  readonly source: EntrySummary;
  readonly label?: string;
  readonly range: SourceRange;
}

export interface BacklinkListing {
  readonly vault: string;
  readonly target: NoteSummary;
  readonly backlinks: readonly Backlink[];
}

/** Notes in any available vault whose references target the resolved note's id. */
export const backlinks = (
  deps: AppDeps,
  scope: Scope,
  query: string,
): Promise<Result<BacklinkListing, AppError>> =>
  withScope(deps, scope, (session) => {
    const target = resolveInScope(session, query);
    if (!target.ok) return target;
    const links: Backlink[] = [];
    for (const { vault, index } of session.opened) {
      for (const ref of index.backlinks(target.value.summary.id)) {
        const source = index.byPath(ref.sourcePath);
        if (!source) continue;
        links.push({
          vault: vault.config.name,
          source,
          ...(ref.label !== undefined && { label: ref.label }),
          range: ref.range,
        });
      }
    }
    return ok({
      vault: target.value.opened.vault.config.name,
      target: target.value.summary,
      backlinks: links,
    });
  });
