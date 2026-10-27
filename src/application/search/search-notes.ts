import { usage, type AppError } from '../../domain/errors.js';
import type { EntrySummary } from '../../domain/note/summary.js';
import { err, ok, type Result } from '../../domain/result.js';
import { interleaveByRank } from '../../domain/scope/interleave.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { AppDeps } from '../ports.js';
import { withScope } from '../scope/session.js';

export interface SearchResult {
  readonly vault: string;
  readonly entry: EntrySummary;
  /** 1-based position within its vault's ranking; what federation interleaves on (A10). */
  readonly rankInVault: number;
  /** bm25, lower is better; comparable only within one vault. */
  readonly score: number;
  readonly snippet: string;
}

export interface SearchOptions {
  readonly limit?: number;
}

/** Each vault ranks on its own; the rankings are interleaved by position, then cut to `limit`. */
export const searchNotes = (
  deps: AppDeps,
  scope: Scope,
  query: string,
  options: SearchOptions = {},
): Promise<Result<SearchResult[], AppError>> => {
  if (query.trim() === '') return Promise.resolve(err(usage('Search query must not be empty')));
  const limit = options.limit ?? 20;
  return withScope(deps, scope, (session) =>
    ok(
      interleaveByRank(
        session.opened.map(({ vault, index }) =>
          index.search(query, limit).map((hit, i) => ({
            vault: vault.config.name,
            entry: hit.entry,
            rankInVault: i + 1,
            score: hit.score,
            snippet: hit.snippet,
          })),
        ),
      ).slice(0, limit),
    ),
  );
};
