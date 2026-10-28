import { bindDate } from '../../application/calendar/bind-date.js';
import type { IsoDate } from '../../domain/calendar/date-binding.js';
import type { TuiState } from './context.js';

/** The note a binding acts on: its id for the service, its title for the message. */
export interface BindTarget {
  readonly id: string;
  readonly title: string;
}

/**
 * Adds or removes `date` under the note's `dates:` and tells the user what happened. Resolves
 * to whether the file changed, so the caller knows when to reload.
 */
export const bindNote = async (
  tui: TuiState,
  note: BindTarget,
  date: IsoDate,
  remove = false,
): Promise<boolean> => {
  const outcome = await bindDate(tui.deps, tui.scope, { note: note.id, date, remove });
  if (!outcome.ok) {
    tui.report(outcome.error);
    return false;
  }
  if (outcome.value.written) {
    tui.notify(remove ? `Unbound ${note.title} from ${date}` : `Bound ${note.title} to ${date}`);
  } else {
    tui.notify(
      remove
        ? `${note.title} is not bound to ${date}`
        : `${note.title} is already bound to ${date}`,
    );
  }
  return outcome.value.written;
};
