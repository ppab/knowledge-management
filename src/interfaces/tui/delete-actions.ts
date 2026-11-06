import { deleteNote, type Referrer } from '../../application/notes/delete-note.js';
import type { NoteLocator } from '../../application/notes/view-note.js';
import type { TuiState } from './context.js';

/** One warn line per note that links in, so the confirmation shows what deletion would orphan. */
export const deleteWarnings = (referrers: readonly Referrer[]): string[] =>
  referrers.length === 0
    ? []
    : [
        `${String(referrers.length)} note(s) link here; their links will dangle:`,
        ...referrers.map((r) => `  ${r.title} (${r.path})`),
      ];

/**
 * Deletes the located note — forcing past the inbound links the confirmation already warned
 * about — and reports the outcome. Resolves to whether it was deleted, so the caller pops or
 * reloads only on success.
 */
export const runDelete = async (
  tui: TuiState,
  locator: NoteLocator,
  title: string,
): Promise<boolean> => {
  const outcome = await deleteNote(tui.deps, tui.scope, locator, { force: true });
  if (!outcome.ok) {
    tui.report(outcome.error);
    return false;
  }
  tui.notify(
    outcome.value.record.kind === 'recorded'
      ? `Deleted ${title} and recorded the removal`
      : `Deleted ${title}`,
  );
  return true;
};
