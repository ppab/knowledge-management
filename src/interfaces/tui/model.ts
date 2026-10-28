import type { NoteLocator } from '../../application/notes/view-note.js';
import type { PanelNoteRef } from '../../application/plugin/plugin.js';
import type { IsoDate } from '../../domain/calendar/date-binding.js';
import type { EntrySummary } from '../../domain/note/summary.js';
import type { Position } from '../../domain/text/rendered.js';
import type { Selection } from './selection.js';

/*
 * The screen stack (docs/architecture.md §6). Every screen's transient state (cursor, scroll,
 * open panel) lives in its stack entry, so popping back restores exactly what was there. The
 * reducer is pure; the React tree renders only the top entry.
 */

export type CalendarView = 'month' | 'week' | 'year' | 'agenda';

export type Screen =
  | {
      readonly kind: 'list';
      readonly cursor: number;
      readonly search?: string;
      readonly tag?: string;
    }
  | {
      readonly kind: 'note';
      readonly locator: NoteLocator;
      readonly scroll: number;
      /** Text cursor in rendered coordinates; unset until first placed (then: first text). */
      readonly cursor?: Position;
      /** `undefined`: the automatic panel (if any); `null`: closed; else a panel id. */
      readonly panel?: string | null;
      readonly panelCursor: number;
      /** Visual selection (`v`); present only while selecting. */
      readonly selection?: Selection;
    }
  /**
   * The calendar: a month grid (with the cursor day's notes beside it on a wide terminal), a
   * week, a year strip or the month's agenda, all sharing one cursor date.
   */
  | {
      readonly kind: 'calendar';
      readonly cursor: IsoDate;
      /** `month` when absent. */
      readonly view?: CalendarView;
      /** Month view only: which side takes the keys; `grid` when absent. */
      readonly focus?: 'grid' | 'list';
      /** Cursor in the day's note list or the agenda; derived from the date when absent. */
      readonly listCursor?: number;
    }
  | { readonly kind: 'day'; readonly date: IsoDate; readonly cursor: number }
  | { readonly kind: 'panel'; readonly id: string; readonly cursor: number }
  /** The revision list; on a wide terminal the selected revision previews beside it. */
  | {
      readonly kind: 'history';
      readonly locator: NoteLocator;
      readonly cursor: number;
      /** What the preview pane shows for the selected revision; `content` when absent. */
      readonly pane?: 'content' | 'diff';
      /** Scroll of the preview pane; 0 when absent. */
      readonly scroll?: number;
    }
  /** A note as it was at one revision (read-only). */
  | {
      readonly kind: 'revision';
      readonly locator: NoteLocator;
      readonly revision: string;
      readonly scroll: number;
    }
  /** A revision against the working file. */
  | {
      readonly kind: 'diff';
      readonly locator: NoteLocator;
      readonly from: string;
      readonly scroll: number;
    };

export type Navigation =
  | { readonly type: 'push'; readonly screen: Screen }
  | { readonly type: 'pop' }
  | { readonly type: 'update'; readonly update: (screen: Screen) => Screen };

export const initialStack = (): Screen[] => [{ kind: 'list', cursor: 0 }];

export const navigate = (stack: readonly Screen[], action: Navigation): Screen[] => {
  switch (action.type) {
    case 'push':
      return [...stack, action.screen];
    case 'pop':
      return stack.length > 1 ? stack.slice(0, -1) : [...stack];
    case 'update': {
      const top = stack[stack.length - 1];
      return top ? [...stack.slice(0, -1), action.update(top)] : [...stack];
    }
  }
};

export const noteScreen = (locator: NoteLocator): Screen => ({
  kind: 'note',
  locator,
  scroll: 0,
  panelCursor: 0,
});

/** Identified notes are addressed by id so a moved file still resolves; others by path. */
export const locatorOf = (ref: PanelNoteRef): NoteLocator =>
  ref.id === undefined ? { vault: ref.vault, path: ref.path } : { query: ref.id };

export const locatorOfEntry = (entry: EntrySummary & { readonly vault: string }): NoteLocator =>
  entry.kind === 'note' ? { query: entry.id } : { vault: entry.vault, path: entry.path };

/** First visible row so that `cursor` stays inside a window of `height` rows. */
export const windowStart = (cursor: number, height: number): number =>
  Math.max(0, cursor - Math.max(1, height) + 1);

export const clamp = (value: number, max: number): number =>
  Math.max(0, Math.min(value, Math.max(0, max)));
