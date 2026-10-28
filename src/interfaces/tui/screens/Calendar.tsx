import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { boundDates, type ScopedDateHit } from '../../../application/calendar/calendar.js';
import { isoDate } from '../../../application/notes/create-note.js';
import type { DateRange, IsoDate } from '../../../domain/calendar/date-binding.js';
import {
  dayMarker,
  daysInMonth,
  MONTH_ABBREVIATIONS,
  monthGrid,
  monthRange,
  monthTitle,
  parseDateJump,
  shiftDays,
  shiftMonths,
  shiftYears,
  weekDays,
  weekRange,
  WEEKDAYS,
  yearMonthOf,
  yearRange,
} from '../../../domain/calendar/month-grid.js';
import { isComposite } from '../../../domain/scope/scope.js';
import { bindNote } from '../calendar-actions.js';
import { screenChords, useLeader } from '../chords.js';
import { Dialog } from '../components/Dialog.js';
import { Frame, useBodyHeight, type Hint } from '../components/Frame.js';
import { Picker, type Picked } from '../components/Picker.js';
import { Prompt } from '../components/Prompt.js';
import { Rows } from '../components/Rows.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, noteScreen, type CalendarView, type Screen } from '../model.js';

type CalendarScreen = Extract<Screen, { kind: 'calendar' }>;

/** A modal step that owns the keyboard: picking a note to bind, or typing a date to jump to. */
type Flow = { readonly kind: 'pick' } | { readonly kind: 'goto' };

/** Below this width the month grid has the screen to itself and `Enter` opens the day screen. */
export const CALENDAR_SIDE_BY_SIDE_MIN_COLUMNS = 90;

/** One month-grid cell per weekday: a space, the two-digit day, and the marker column. */
const CELL_WIDTH = 4;
const GRID_WIDTH = CELL_WIDTH * 7 + 2;
const WEEKEND = new Set([5, 6]);

export const GOTO_LABEL = 'go to (YYYY-MM-DD or YYYY-MM):';

/** The views in tab order, with the key that opens each. */
export const VIEWS: readonly (readonly [key: string, view: CalendarView])[] = [
  ['m', 'month'],
  ['w', 'week'],
  ['y', 'year'],
  ['a', 'agenda'],
];

const rangeFor = (view: CalendarView, cursor: IsoDate): DateRange =>
  view === 'week'
    ? weekRange(cursor)
    : view === 'year'
      ? yearRange(cursor)
      : monthRange(yearMonthOf(cursor));

/** Where the agenda cursor lands for a date: its first row on or after that day. */
const agendaIndexFor = (hits: readonly ScopedDateHit[], date: IsoDate): number => {
  const at = hits.findIndex((hit) => hit.date >= date);
  return at === -1 ? Math.max(0, hits.length - 1) : at;
};

/**
 * The calendar. A day is marked when a note is bound to it under `dates:` (never by mtime);
 * the marker tells how many. Four views share one cursor date: the month grid (on a wide
 * terminal the cursor day's notes list beside it), the week, a year strip of months by days,
 * and the month's agenda. `d` opens the cursor day as a screen.
 */
export const Calendar = ({ screen }: { readonly screen: CalendarScreen }) => {
  const tui = useTui();
  const { deps, scope, revision, columns, navigate, notify, report, theme } = tui;
  const height = useBodyHeight();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [local, setLocal] = useState(0);
  const leader = useLeader(screenChords(tui), flow === null);
  const today = isoDate(deps.clock.now());
  const view = screen.view ?? 'month';
  const cursor = screen.cursor;
  const month = yearMonthOf(cursor);
  const wide = columns >= CALENDAR_SIDE_BY_SIDE_MIN_COLUMNS;
  const composite = isComposite(scope);
  const range = rangeFor(view, cursor);

  const loaded = useLoad(
    () => boundDates(deps, scope, range),
    [range.from, range.to, revision, local],
  );
  const hits = loaded.value ?? [];
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.date, (counts.get(hit.date) ?? 0) + 1);
  const onDay = (date: IsoDate) => hits.filter((hit) => hit.date === date);

  // The row list that `j/k`, `Enter` and `x` act on: the cursor day's notes, or the agenda.
  const focus = view === 'month' && wide ? (screen.focus ?? 'grid') : 'grid';
  const rows = view === 'agenda' ? hits : view === 'month' && wide ? onDay(cursor) : [];
  const listCursor = clamp(
    screen.listCursor ?? (view === 'agenda' ? agendaIndexFor(hits, cursor) : 0),
    rows.length - 1,
  );
  const selected = rows[listCursor];

  const update = (patch: Partial<CalendarScreen>) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'calendar' ? { ...s, ...patch } : s) });
  };
  /** Moves the cursor date; list positions start over. */
  const go = (date: IsoDate) => {
    update({ cursor: date, listCursor: 0 });
  };
  /** Switches view; list position and focus are derived afresh from the cursor date. */
  const switchView = (next: CalendarView) => {
    navigate({
      type: 'update',
      update: (s) => {
        if (s.kind !== 'calendar') return s;
        const { listCursor: _list, focus: _focus, ...rest } = s;
        return { ...rest, view: next };
      },
    });
  };
  const reload = () => {
    setLocal((n) => n + 1);
  };
  const openDay = (date: IsoDate) => {
    navigate({ type: 'push', screen: { kind: 'day', date, cursor: 0 } });
  };

  const onPicked = (picked: Picked) => {
    setFlow(null);
    void bindNote(tui, picked, cursor).then((written) => {
      if (written) reload();
    });
  };
  const onGoto = (value: string) => {
    setFlow(null);
    if (value.trim() === '') return;
    const parsed = parseDateJump(value);
    if (parsed.ok) go(parsed.value);
    else report(parsed.error);
  };
  const unbindSelected = () => {
    if (!selected) {
      notify(view === 'agenda' ? 'No bindings this month' : `No notes bound to ${cursor}`);
      return;
    }
    void bindNote(tui, selected.entry, selected.date, true).then((written) => {
      if (written) reload();
    });
  };
  const openSelected = () => {
    if (selected) {
      navigate({
        type: 'push',
        screen: noteScreen({ vault: selected.vault, path: selected.entry.path }),
      });
    }
  };
  const moveList = (delta: number) => {
    const next = clamp(listCursor + delta, rows.length - 1);
    const row = rows[next];
    update({ listCursor: next, ...(view === 'agenda' && row && { cursor: row.date }) });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) {
        navigate({ type: 'pop' });
        return;
      }
      const tab = VIEWS.find(([k]) => k === input);
      if (tab) {
        if (tab[1] !== view) switchView(tab[1]);
        return;
      }
      if (input === 'd') {
        openDay(cursor);
        return;
      }
      if (input === 'b') {
        setFlow({ kind: 'pick' });
        return;
      }
      if (input === 'g') {
        setFlow({ kind: 'goto' });
        return;
      }
      if (input === 't') {
        go(today);
        return;
      }
      if (input === '[') {
        go(shiftMonths(cursor, -1));
        return;
      }
      if (input === ']') {
        go(shiftMonths(cursor, 1));
        return;
      }
      if (input === '{') {
        go(shiftYears(cursor, -1));
        return;
      }
      if (input === '}') {
        go(shiftYears(cursor, 1));
        return;
      }
      if (input === 'x' && (view === 'agenda' || (view === 'month' && wide))) {
        unbindSelected();
        return;
      }
      if (view === 'agenda' || focus === 'list') {
        if (isDown(input, key)) moveList(1);
        else if (isUp(input, key)) moveList(-1);
        else if (key.return) openSelected();
        else if (focus === 'list' && (key.tab || input === 'h' || key.leftArrow)) {
          update({ focus: 'grid' });
        }
        return;
      }
      if (input === 'h' || key.leftArrow) go(shiftDays(cursor, -1));
      else if (input === 'l' || key.rightArrow) go(shiftDays(cursor, 1));
      else if (isDown(input, key)) {
        go(view === 'year' ? shiftMonths(cursor, 1) : shiftDays(cursor, 7));
      } else if (isUp(input, key)) {
        go(view === 'year' ? shiftMonths(cursor, -1) : shiftDays(cursor, -7));
      } else if (key.return || key.tab) {
        if (view === 'year') switchView('month');
        else if (view === 'week' || !wide) openDay(cursor);
        else if (rows.length === 0) notify(`No notes bound to ${cursor}; press b to bind one`);
        else update({ focus: 'list' });
      }
    },
    { isActive: flow === null && !leader.pending },
  );

  const tabs = (
    <Text wrap="truncate">
      {VIEWS.map(([key, name], i) => (
        <Text key={name}>
          {i > 0 ? '  ' : ''}
          <Text {...theme.paint('accent')}>{key}</Text>
          <Text bold={name === view} dimColor={name !== view}>
            {' '}
            {name}
          </Text>
        </Text>
      ))}
      {'  '}
      <Text {...theme.paint('accent')}>d</Text>
      <Text dimColor> day</Text>
    </Text>
  );

  const dayStyle = (date: IsoDate, column: number) => {
    const count = counts.get(date) ?? 0;
    const role = date === today ? 'accent' : count > 0 ? 'link' : null;
    return {
      inverse: date === cursor,
      bold: date === today || count > 0,
      dimColor: role === null && WEEKEND.has(column),
      ...(role ? theme.paint(role) : {}),
    };
  };

  const onCursor = counts.get(cursor) ?? 0;
  const cursorLine = (
    <Text>
      {cursor}: {String(onCursor)} note{onCursor === 1 ? '' : 's'}
      {cursor === today && <Text dimColor> · today</Text>}
    </Text>
  );
  const error = loaded.state === 'error' && (
    <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>
  );

  const monthView = (
    <Box flexDirection="column" paddingLeft={1} width={GRID_WIDTH} flexShrink={0}>
      <Text dimColor>{WEEKDAYS.map((d) => ` ${d} `).join('')}</Text>
      {monthGrid(month).map((week, w) => (
        <Text key={w}>
          {week.map((date, d) =>
            date === null ? (
              <Text key={d}>{' '.repeat(CELL_WIDTH)}</Text>
            ) : (
              <Text key={d}>
                {' '}
                <Text {...dayStyle(date, d)}>
                  {String(Number(date.slice(8))).padStart(2)}
                  {dayMarker(counts.get(date) ?? 0)}
                </Text>
              </Text>
            ),
          )}
        </Text>
      ))}
      <Text> </Text>
      {cursorLine}
      {error}
    </Box>
  );

  const weekWidth = Math.max(8, Math.floor((columns - 1) / 7));
  const weekRows = Math.max(1, height - 3);
  const weekView = (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {weekDays(cursor).map((date, i) => {
          const notes = onDay(date);
          const shown = notes.slice(0, weekRows);
          return (
            <Box key={date} flexDirection="column" width={weekWidth} paddingLeft={1}>
              <Text {...dayStyle(date, i)} wrap="truncate">
                {WEEKDAYS[i]} {String(Number(date.slice(8))).padStart(2)}
                {date === today ? ' ·' : ''}
              </Text>
              {shown.map((hit, j) => (
                <Text key={`${hit.vault}:${hit.entry.path}:${String(j)}`} wrap="truncate">
                  {hit.entry.title}
                </Text>
              ))}
              {notes.length > shown.length && (
                <Text dimColor>+{String(notes.length - shown.length)} more</Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Text> </Text>
      <Box paddingLeft={1}>{cursorLine}</Box>
      {error}
    </Box>
  );

  const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
  const yearView = (
    <Box flexDirection="column" paddingLeft={1}>
      <Text dimColor>
        {'    '}
        {DAYS.map((d) => (d === 1 || d % 5 === 0 ? String(d).padStart(2) : '  ')).join('')}
      </Text>
      {MONTH_ABBREVIATIONS.map((name, m) => {
        const length = daysInMonth({ year: month.year, month: m + 1 });
        return (
          <Text key={name}>
            <Text dimColor={m + 1 !== month.month}>{name} </Text>
            {DAYS.map((d) => {
              if (d > length) return <Text key={d}>{'  '}</Text>;
              const date = `${String(month.year)}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const count = counts.get(date) ?? 0;
              const role = date === today ? 'accent' : count > 0 ? 'link' : null;
              return (
                <Text key={d}>
                  <Text
                    inverse={date === cursor}
                    bold={role !== null}
                    dimColor={role === null}
                    {...(role ? theme.paint(role) : {})}
                  >
                    {count === 0 ? '·' : count < 10 ? String(count) : '+'}
                  </Text>{' '}
                </Text>
              );
            })}
          </Text>
        );
      })}
      <Text> </Text>
      {cursorLine}
      {error}
    </Box>
  );

  const agendaView = (
    <Rows
      header={['date', 'title', 'tags', ...(composite ? ['vault'] : [])]}
      rows={hits.map((hit, i) => [
        hits[i - 1]?.date === hit.date ? '' : hit.date,
        hit.entry.title,
        hit.entry.tags.join(' '),
        ...(composite ? [hit.vault] : []),
      ])}
      roles={['muted', null, 'tag', 'muted']}
      cursor={listCursor}
      height={height}
      empty={
        loaded.state === 'loading'
          ? 'loading…'
          : loaded.state === 'error'
            ? `error: ${loaded.error.message}`
            : `No notes bound in ${monthTitle(month)}; b binds one to ${cursor}.`
      }
    />
  );

  const listFocused = focus === 'list';
  const dayList = (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderLeft
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderDimColor
      paddingLeft={1}
      overflow="hidden"
    >
      <Text bold={listFocused} dimColor={!listFocused} {...theme.paint('accent')}>
        notes on {cursor}
      </Text>
      <Rows
        header={['title', 'id', ...(composite ? ['vault'] : [])]}
        rows={rows.map((hit) => [hit.entry.title, hit.entry.id, ...(composite ? [hit.vault] : [])])}
        roles={[null, 'muted', 'muted']}
        cursor={listCursor}
        height={height - 1}
        empty={loaded.state === 'loading' ? 'loading…' : 'No notes bound to this day; b binds one.'}
      />
    </Box>
  );

  const goto = flow?.kind === 'goto' && (
    <Dialog width={GOTO_LABEL.length + 16}>
      <Prompt
        label={GOTO_LABEL}
        onSubmit={onGoto}
        onCancel={() => {
          setFlow(null);
        }}
      />
    </Dialog>
  );

  const common: Hint[] = [
    ['t', 'today'],
    ['g', 'go to'],
    ['b', 'bind'],
    ['Space', 'menu'],
    ['Esc', 'back'],
  ];
  const hints: Hint[] = listFocused
    ? [['j/k', 'move'], ['Enter', 'open'], ['x', 'unbind'], ['Tab/h', 'grid'], ...common]
    : view === 'agenda'
      ? [['j/k', 'move'], ['[ ]', 'month'], ['Enter', 'open'], ['x', 'unbind'], ...common]
      : view === 'year'
        ? [['h/l', 'day'], ['j/k', 'month'], ['{ }', 'year'], ['Enter', 'month view'], ...common]
        : [
            ['hjkl', 'move'],
            ['[ ]', 'month'],
            ['{ }', 'year'],
            ...(view === 'month' && wide ? ([['x', 'unbind']] as const) : []),
            ['Enter', view === 'month' && wide ? 'notes' : 'day'],
            ...common,
          ];
  const title =
    view === 'week'
      ? `calendar · week of ${range.from}`
      : view === 'year'
        ? `calendar · ${String(month.year)}`
        : `calendar · ${monthTitle(month)}`;
  return (
    <Frame
      title={title}
      meta={tabs}
      hints={hints}
      {...(listFocused && { mode: 'notes' })}
      overlay={leader.popup}
    >
      {flow?.kind === 'pick' ? (
        <Picker
          height={height}
          onPick={onPicked}
          onCancel={() => {
            setFlow(null);
          }}
        />
      ) : (
        <Box flexDirection="column" height={height}>
          {goto}
          {view === 'month' ? (
            wide ? (
              <Box flexDirection="row" flexGrow={1}>
                {monthView}
                {dayList}
              </Box>
            ) : (
              monthView
            )
          ) : view === 'week' ? (
            weekView
          ) : view === 'year' ? (
            yearView
          ) : (
            agendaView
          )}
        </Box>
      )}
    </Frame>
  );
};
