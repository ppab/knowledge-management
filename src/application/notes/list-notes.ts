import { parseDateRange } from '../../domain/calendar/date-binding.js';
import type { AppError } from '../../domain/errors.js';
import type { EntrySummary } from '../../domain/note/summary.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { datesInRange } from '../calendar/calendar.js';
import type { AppDeps } from '../ports.js';
import { withScope } from '../scope/session.js';

export interface ListFilters {
  readonly unidentified?: boolean;
  readonly tag?: string;
  /** `YYYY-MM-DD` or `FROM..TO`; keeps notes bound to a date in the range. */
  readonly date?: string;
}

export type ScopedEntry = EntrySummary & { readonly vault: string };

/** Every entry of every available vault, in scope order then path order. */
export const listNotes = (
  deps: AppDeps,
  scope: Scope,
  filters: ListFilters = {},
): Promise<Result<ScopedEntry[], AppError>> => {
  const range = filters.date === undefined ? undefined : parseDateRange(filters.date);
  if (range && !range.ok) return Promise.resolve(range);
  return withScope(deps, scope, (session) =>
    ok(
      session.opened.flatMap(({ vault, index }) => {
        let entries = index.all();
        if (filters.unidentified) entries = entries.filter((e) => e.kind === 'unidentified');
        if (filters.tag !== undefined) {
          const tag = filters.tag;
          entries = entries.filter((e) => e.tags.includes(tag));
        }
        if (range) {
          const bound = new Set(datesInRange(index, range.value).map((hit) => hit.entry.path));
          entries = entries.filter((e) => bound.has(e.path));
        }
        return entries.map((entry) => ({ ...entry, vault: vault.config.name }));
      }),
    ),
  );
};
