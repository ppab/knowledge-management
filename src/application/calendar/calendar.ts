import type { DateRange, IsoDate } from '../../domain/calendar/date-binding.js';
import type { NoteSummary } from '../../domain/note/summary.js';
import type { DateHit, NoteIndex } from '../ports.js';

export const notesOnDate = (index: NoteIndex, date: IsoDate): NoteSummary[] => index.onDate(date);

export const datesInRange = (index: NoteIndex, range: DateRange): DateHit[] =>
  index.datesBetween(range.from, range.to);
