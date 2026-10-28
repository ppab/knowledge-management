import { Text, useInput } from 'ink';
import { listNotes } from '../../../application/notes/list-notes.js';
import { isComposite } from '../../../domain/scope/scope.js';
import { screenChords, useLeader } from '../chords.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import { Rows } from '../components/Rows.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, locatorOfEntry, noteScreen, type Screen } from '../model.js';

type DayScreen = Extract<Screen, { kind: 'day' }>;

/** The notes bound to one day, opened from the calendar. */
export const Day = ({ screen }: { readonly screen: DayScreen }) => {
  const tui = useTui();
  const { deps, scope, revision, navigate, theme } = tui;
  const height = useBodyHeight();
  const leader = useLeader(screenChords(tui), true);
  const loaded = useLoad(
    () => listNotes(deps, scope, { date: screen.date }),
    [screen.date, revision],
  );
  const entries = loaded.value ?? [];
  const cursor = clamp(screen.cursor, entries.length - 1);
  const composite = isComposite(scope);

  const update = (c: number) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'day' ? { ...s, cursor: c } : s) });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) navigate({ type: 'pop' });
      else if (isDown(input, key)) update(clamp(cursor + 1, entries.length - 1));
      else if (isUp(input, key)) update(clamp(cursor - 1, entries.length - 1));
      else if (key.return) {
        const entry = entries[cursor];
        if (entry) navigate({ type: 'push', screen: noteScreen(locatorOfEntry(entry)) });
      }
    },
    { isActive: !leader.pending },
  );

  return (
    <Frame
      title={`notes on ${screen.date}`}
      hints={[
        ['j/k', 'move'],
        ['Enter', 'open'],
        ['Space', 'menu'],
        ['Esc', 'back'],
      ]}
      overlay={leader.popup}
    >
      {loaded.state === 'error' && loaded.value === undefined ? (
        <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>
      ) : (
        <Rows
          header={['id', 'title', ...(composite ? ['vault'] : [])]}
          rows={entries.map((e) => [
            e.kind === 'note' ? e.id : '-',
            e.title,
            ...(composite ? [e.vault] : []),
          ])}
          roles={['muted', null, 'muted']}
          cursor={cursor}
          height={height}
          empty="No notes bound to this day."
        />
      )}
    </Frame>
  );
};
