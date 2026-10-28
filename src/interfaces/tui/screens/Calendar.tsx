import { Box, Text, useInput } from 'ink';
import { boundDates } from '../../../application/calendar/calendar.js';
import {
  monthGrid,
  monthRange,
  monthTitle,
  shiftDays,
  shiftMonths,
  WEEKDAYS,
  yearMonthOf,
} from '../../../domain/calendar/month-grid.js';
import { screenChords, useLeader } from '../chords.js';
import { Frame } from '../components/Frame.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import type { Screen } from '../model.js';

type CalendarScreen = Extract<Screen, { kind: 'calendar' }>;

/** Month grid; a day is marked when a note is bound to it under `dates:` (never by mtime). */
export const Calendar = ({ screen }: { readonly screen: CalendarScreen }) => {
  const tui = useTui();
  const { deps, scope, revision, navigate, theme } = tui;
  const leader = useLeader(screenChords(tui), true);
  const month = yearMonthOf(screen.cursor);
  const loaded = useLoad(
    () => boundDates(deps, scope, monthRange(month)),
    [month.year, month.month, revision],
  );
  const counts = new Map<string, number>();
  for (const hit of loaded.value ?? []) counts.set(hit.date, (counts.get(hit.date) ?? 0) + 1);

  const go = (cursor: string) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'calendar' ? { ...s, cursor } : s) });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) navigate({ type: 'pop' });
      else if (input === 'h' || key.leftArrow) go(shiftDays(screen.cursor, -1));
      else if (input === 'l' || key.rightArrow) go(shiftDays(screen.cursor, 1));
      else if (isDown(input, key)) go(shiftDays(screen.cursor, 7));
      else if (isUp(input, key)) go(shiftDays(screen.cursor, -7));
      else if (input === '[') go(shiftMonths(screen.cursor, -1));
      else if (input === ']') go(shiftMonths(screen.cursor, 1));
      else if (key.return) {
        navigate({ type: 'push', screen: { kind: 'day', date: screen.cursor, cursor: 0 } });
      }
    },
    { isActive: !leader.pending },
  );

  const onCursor = counts.get(screen.cursor) ?? 0;
  return (
    <Frame
      title={`calendar · ${monthTitle(month)}`}
      hints={[
        ['h/j/k/l', 'move'],
        ['[ ]', 'month'],
        ['Enter', 'notes on day'],
        ['Space', 'menu'],
        ['Esc', 'back'],
      ]}
      overlay={leader.popup}
    >
      <Box flexDirection="column" paddingLeft={1}>
        <Text dimColor>{WEEKDAYS.map((d) => ` ${d}`).join('')}</Text>
        {monthGrid(month).map((week, w) => (
          <Text key={w}>
            {week.map((date, d) => {
              if (date === null) return <Text key={d}>{'    '}</Text>;
              const bound = counts.has(date);
              return (
                <Text key={d}>
                  {' '}
                  <Text
                    inverse={date === screen.cursor}
                    bold={bound}
                    {...(bound ? theme.paint('link') : {})}
                  >
                    {String(Number(date.slice(8))).padStart(2)}
                    {bound ? '*' : ' '}
                  </Text>
                </Text>
              );
            })}
          </Text>
        ))}
        <Text>
          {'\n'}
          {screen.cursor}: {String(onCursor)} note{onCursor === 1 ? '' : 's'}
        </Text>
        {loaded.state === 'error' && (
          <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>
        )}
      </Box>
    </Frame>
  );
};
