import { parseDateRange } from '../../domain/calendar/date-binding.js';
import type { AppError } from '../../domain/errors.js';
import type { EntrySummary } from '../../domain/note/summary.js';
import { ok, type Result } from '../../domain/result.js';
import { datesInRange } from '../calendar/calendar.js';
import { withFreshIndex } from '../index/refresh-index.js';
import type { AppDeps } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';

export interface ListFilters {
  readonly unidentified?: boolean;
  readonly tag?: string;
  /** `YYYY-MM-DD` or `FROM..TO`; keeps notes bound to a date in the range. */
  readonly date?: string;
}

export const listNotes = (
  deps: AppDeps,
  vault: VaultHandle,
  filters: ListFilters = {},
): Promise<Result<EntrySummary[], AppError>> =>
  withFreshIndex(deps, vault, (index) => {
    let entries = index.all();
    if (filters.unidentified) entries = entries.filter((e) => e.kind === 'unidentified');
    if (filters.tag !== undefined) {
      const tag = filters.tag;
      entries = entries.filter((e) => e.tags.includes(tag));
    }
    if (filters.date !== undefined) {
      const range = parseDateRange(filters.date);
      if (!range.ok) return range;
      const bound = new Set(datesInRange(index, range.value).map((hit) => hit.entry.path));
      entries = entries.filter((e) => bound.has(e.path));
    }
    return ok(entries);
  });
