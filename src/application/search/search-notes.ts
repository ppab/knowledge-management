import { usage, type AppError } from '../../domain/errors.js';
import type { EntrySummary } from '../../domain/note/summary.js';
import { err, ok, type Result } from '../../domain/result.js';
import { withFreshIndex } from '../index/refresh-index.js';
import type { AppDeps } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';

export interface SearchResult {
  readonly vault: string;
  readonly entry: EntrySummary;
  /** 1-based position within this vault's ranking; what federation interleaves on (M4). */
  readonly rankInVault: number;
  readonly score: number;
  readonly snippet: string;
}

export interface SearchOptions {
  readonly limit?: number;
}

export const searchNotes = (
  deps: AppDeps,
  vault: VaultHandle,
  query: string,
  options: SearchOptions = {},
): Promise<Result<SearchResult[], AppError>> => {
  if (query.trim() === '') return Promise.resolve(err(usage('Search query must not be empty')));
  return withFreshIndex(deps, vault, (index) =>
    ok(
      index.search(query, options.limit ?? 20).map((hit, i) => ({
        vault: vault.config.name,
        entry: hit.entry,
        rankInVault: i + 1,
        score: hit.score,
        snippet: hit.snippet,
      })),
    ),
  );
};
