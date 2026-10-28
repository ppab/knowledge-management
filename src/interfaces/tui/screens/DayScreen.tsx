import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { isoDate } from '../../../application/notes/create-note.js';
import { listNotes, type ScopedEntry } from '../../../application/notes/list-notes.js';
import { viewNote } from '../../../application/notes/view-note.js';
import { shiftDays } from '../../../domain/calendar/month-grid.js';
import { ok } from '../../../domain/result.js';
import { isComposite } from '../../../domain/scope/scope.js';
import { lineText } from '../../../domain/text/rendered.js';
import { bindNote } from '../calendar-actions.js';
import { screenChords, useLeader } from '../chords.js';
import { CURSOR_MARK } from '../components/Rows.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import { Picker, type Picked } from '../components/Picker.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, locatorOfEntry, noteScreen, windowStart, type Screen } from '../model.js';

type DayScreen = Extract<Screen, { kind: 'day' }>;

/** Body lines shown under each title. */
const EXCERPT_LINES = 2;
const NO_MARK = ' '.repeat(CURSOR_MARK.length);

interface DayNote {
  readonly entry: ScopedEntry;
  readonly excerpt: readonly string[];
}

const ROWS_PER_NOTE = 1 + EXCERPT_LINES;

/**
 * One day: every note bound to it with its tags and the first lines of its body. `h/l` move
 * to the neighbouring days, `b` binds another note, `x` unbinds the one under the cursor.
 */
export const Day = ({ screen }: { readonly screen: DayScreen }) => {
  const tui = useTui();
  const { deps, scope, revision, columns, navigate, notify, theme } = tui;
  const height = useBodyHeight();
  const [picking, setPicking] = useState(false);
  const [local, setLocal] = useState(0);
  const leader = useLeader(screenChords(tui), !picking);
  const today = isoDate(deps.clock.now());
  const composite = isComposite(scope);
  const width = Math.max(10, columns - CURSOR_MARK.length - 2);

  const loaded = useLoad(async () => {
    const listed = await listNotes(deps, scope, { date: screen.date });
    if (!listed.ok) return listed;
    const notes: DayNote[] = [];
    for (const entry of listed.value) {
      const read = await viewNote(deps, scope, locatorOfEntry(entry));
      const excerpt = read.ok
        ? deps.markdown
            .render(read.value.entry.source, read.value.entry.body.start, { width })
            .flatMap((line) => lineText(line).split('\n')) // soft breaks stay inside a line
            .filter((text) => text.trim() !== '' && text.trim() !== `# ${entry.title}`)
            .slice(0, EXCERPT_LINES)
        : [`error: ${read.error.message}`];
      notes.push({ entry, excerpt });
    }
    return ok(notes);
  }, [screen.date, revision, local, width]);
  const notes = loaded.value ?? [];
  const cursor = clamp(screen.cursor, notes.length - 1);

  const update = (patch: Partial<DayScreen>) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'day' ? { ...s, ...patch } : s) });
  };
  const reload = () => {
    setLocal((n) => n + 1);
  };
  const onPicked = (picked: Picked) => {
    setPicking(false);
    void bindNote(tui, picked, screen.date).then((written) => {
      if (written) reload();
    });
  };
  const unbindSelected = () => {
    const entry = notes[cursor]?.entry;
    if (!entry) {
      notify(`No notes bound to ${screen.date}`);
      return;
    }
    if (entry.kind !== 'note') {
      notify(`${entry.path} has no id; adopt it before changing its dates`, 'error');
      return;
    }
    void bindNote(tui, entry, screen.date, true).then((written) => {
      if (written) reload();
    });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) navigate({ type: 'pop' });
      else if (isDown(input, key)) update({ cursor: clamp(cursor + 1, notes.length - 1) });
      else if (isUp(input, key)) update({ cursor: clamp(cursor - 1, notes.length - 1) });
      else if (input === 'h' || key.leftArrow)
        update({ date: shiftDays(screen.date, -1), cursor: 0 });
      else if (input === 'l' || key.rightArrow)
        update({ date: shiftDays(screen.date, 1), cursor: 0 });
      else if (input === 't') update({ date: today, cursor: 0 });
      else if (input === 'b') setPicking(true);
      else if (input === 'x') unbindSelected();
      else if (key.return) {
        const entry = notes[cursor]?.entry;
        if (entry) navigate({ type: 'push', screen: noteScreen(locatorOfEntry(entry)) });
      }
    },
    { isActive: !picking && !leader.pending },
  );

  const perScreen = Math.max(1, Math.floor(height / ROWS_PER_NOTE));
  const start = windowStart(cursor, perScreen);
  const visible = notes.slice(start, start + perScreen);
  const count = notes.length;
  return (
    <Frame
      title={`${screen.date}${screen.date === today ? ' · today' : ''}`}
      meta={`${String(count)} note${count === 1 ? '' : 's'}`}
      hints={[
        ['j/k', 'move'],
        ['h/l', 'day'],
        ['t', 'today'],
        ['Enter', 'open'],
        ['b', 'bind'],
        ['x', 'unbind'],
        ['Space', 'menu'],
        ['Esc', 'back'],
      ]}
      overlay={leader.popup}
    >
      {picking ? (
        <Picker
          height={height}
          onPick={onPicked}
          onCancel={() => {
            setPicking(false);
          }}
        />
      ) : loaded.state === 'error' && loaded.value === undefined ? (
        <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>
      ) : notes.length === 0 ? (
        <Text dimColor>
          {loaded.state === 'loading' ? 'loading…' : 'No notes bound to this day; b binds one.'}
        </Text>
      ) : (
        <Box flexDirection="column">
          {visible.map(({ entry, excerpt }, i) => {
            const at = start + i === cursor;
            return (
              <Box key={`${entry.vault}:${entry.path}`} flexDirection="column">
                <Text wrap="truncate">
                  <Text bold={at} {...(at ? theme.paint('accent') : {})}>
                    {at ? CURSOR_MARK : NO_MARK}
                    {entry.title}
                  </Text>
                  {entry.tags.length > 0 && (
                    <Text {...theme.paint('tag')}> {entry.tags.map((t) => `#${t}`).join(' ')}</Text>
                  )}
                  {composite && <Text dimColor> · {entry.vault}</Text>}
                </Text>
                {Array.from({ length: EXCERPT_LINES }, (_, j) => (
                  <Text key={j} dimColor wrap="truncate">
                    {NO_MARK}
                    {excerpt[j] ?? ' '}
                  </Text>
                ))}
              </Box>
            );
          })}
        </Box>
      )}
    </Frame>
  );
};
