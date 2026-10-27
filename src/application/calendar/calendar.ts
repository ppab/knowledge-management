import type { DateRange, IsoDate } from '../../domain/calendar/date-binding.js';
import type { AppError } from '../../domain/errors.js';
import type { NoteSummary } from '../../domain/note/summary.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { DateHit, NoteIndex } from '../ports.js';
import type { AppDeps } from '../ports.js';
import { withScope } from '../scope/session.js';

export const notesOnDate = (index: NoteIndex, date: IsoDate): NoteSummary[] => index.onDate(date);

export const datesInRange = (index: NoteIndex, range: DateRange): DateHit[] =>
  index.datesBetween(range.from, range.to);

export type ScopedDateHit = DateHit & { readonly vault: string };

/** Every `dates:` binding in the range across the scope, ordered by date then vault then path. */
export const boundDates = (
  deps: AppDeps,
  scope: Scope,
  range: DateRange,
): Promise<Result<ScopedDateHit[], AppError>> =>
  withScope(deps, scope, (session) =>
    ok(
      session.opened
        .flatMap(({ vault, index }) =>
          datesInRange(index, range).map((hit) => ({ ...hit, vault: vault.config.name })),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.vault.localeCompare(b.vault)),
    ),
  );
