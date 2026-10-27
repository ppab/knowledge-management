import {
  isWithin,
  parseDateRange,
  type DateRange,
  type IsoDate,
} from '../../domain/calendar/date-binding.js';
import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type { ScopedEntry } from '../../application/notes/list-notes.js';

/*
 * Pure views over index entries. A todo is an identified note whose `type` is `todo`; its
 * fields are read leniently here (validation is `doctor`'s job), so a todo with a malformed
 * `due` still lists, just without a due date.
 */

export const TODO_TYPE = 'todo';
export const STATUSES = ['open', 'done'] as const;

export interface Todo {
  readonly vault: string;
  readonly path: string;
  readonly id: string;
  readonly title: string;
  /** As written in the file; `undefined` when missing. Anything but `done` counts as open. */
  readonly status?: string;
  readonly due?: IsoDate;
  readonly priority?: number;
}

export const todoOf = (entry: ScopedEntry): Todo | null => {
  if (entry.kind !== 'note' || entry.type !== TODO_TYPE) return null;
  const { status, due, priority } = entry.fields;
  return {
    vault: entry.vault,
    path: entry.path,
    id: entry.id,
    title: entry.title,
    ...(typeof status === 'string' && { status }),
    ...(typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due) && { due }),
    ...(typeof priority === 'number' && { priority }),
  };
};

export const isDone = (todo: Todo): boolean => todo.status === 'done';

export type StatusFilter = 'open' | 'done' | 'all';

export interface TodoFilter {
  readonly status?: StatusFilter;
  readonly due?: DateRange;
}

export const filterTodos = (todos: readonly Todo[], filter: TodoFilter): Todo[] =>
  todos.filter((todo) => {
    const status = filter.status ?? 'open';
    if (status === 'open' && isDone(todo)) return false;
    if (status === 'done' && !isDone(todo)) return false;
    if (filter.due && (todo.due === undefined || !isWithin(todo.due, filter.due))) return false;
    return true;
  });

/** Due date first (undated last), then higher priority, then title. */
export const sortTodos = (todos: readonly Todo[]): Todo[] =>
  [...todos].sort(
    (a, b) =>
      (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.title.localeCompare(b.title),
  );

export const overdue = (todos: readonly Todo[], today: IsoDate): Todo[] =>
  todos.filter((todo) => !isDone(todo) && todo.due !== undefined && todo.due < today);

/** `today`, `YYYY-MM-DD` or `FROM..TO`. */
export const parseDue = (input: string, today: IsoDate): Result<DateRange, AppError> =>
  input === 'today' ? ok({ from: today, to: today }) : parseDateRange(input);
