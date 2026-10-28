import { Box, Text, useInput } from 'ink';
import {
  diffRevisions,
  listRevisions,
  readRevision,
} from '../../../application/history/history.js';
import type { AppError } from '../../../domain/errors.js';
import { isNote } from '../../../domain/note/note.js';
import { ok, type Result } from '../../../domain/result.js';
import { abbreviate, type Revision } from '../../../domain/revision/revision.js';
import { screenChords, useLeader } from '../chords.js';
import { Frame, useBodyHeight, type Hint } from '../components/Frame.js';
import { Rows } from '../components/Rows.js';
import { ScrollText, scrolledBy, type TextLine } from '../components/ScrollText.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, type Screen } from '../model.js';
import { diffLine } from './DiffView.js';

type HistoryScreen = Extract<Screen, { kind: 'history' }>;

/** `2026-10-27 13:22`, as the CLI prints it. */
export const revisionDate = (revision: Revision): string =>
  revision.timestamp.slice(0, 16).replace('T', ' ');

export const revisionRow = (revision: Revision): string[] => [
  abbreviate(revision.id),
  revisionDate(revision),
  revision.author ?? '-',
  revision.summary,
];

/** Below this width the list has the screen to itself and `Enter`/`d` open full screens. */
export const SIDE_BY_SIDE_MIN_COLUMNS = 100;

interface Preview {
  readonly title: string;
  readonly lines: readonly TextLine[];
  readonly empty: string;
}

const NO_PREVIEW: Preview = { title: '', lines: [], empty: '' };

/**
 * The recorded revisions of a note. On a wide terminal the selected revision shows beside the
 * list, as its content or (`d`) as a diff against the working file; `Enter` opens the content
 * full screen. On a narrow one `Enter` and `d` push those screens instead.
 */
export const History = ({ screen }: { readonly screen: HistoryScreen }) => {
  const tui = useTui();
  const { deps, scope, revision: tick, columns, navigate, notify, theme } = tui;
  const height = useBodyHeight();
  const leader = useLeader(screenChords(tui), true);
  const loaded = useLoad(() => listRevisions(deps, scope, screen.locator), [screen.locator, tick]);
  const history = loaded.value;
  const revisions = history?.revisions ?? [];
  const cursor = clamp(screen.cursor, revisions.length - 1);
  const selected = revisions[cursor];
  const pane = screen.pane ?? 'content';
  const wide = columns >= SIDE_BY_SIDE_MIN_COLUMNS;
  const listWidth = Math.min(56, Math.floor(columns * 0.45));
  const previewWidth = Math.max(10, columns - listWidth - 2);
  const previewHeight = Math.max(1, height - 1);

  const preview = useLoad(async (): Promise<Result<Preview, AppError>> => {
    if (!wide || !selected) return ok(NO_PREVIEW);
    const stamp = `${abbreviate(selected.id)} · ${revisionDate(selected)} · ${selected.summary}`;
    if (pane === 'content') {
      const read = await readRevision(deps, scope, screen.locator, selected.id);
      if (!read.ok) return read;
      const lines = deps.markdown
        .render(read.value.entry.source, read.value.entry.body.start, { width: previewWidth })
        .map((line): TextLine => ({ text: line.spans.map((s) => s.text).join('') }));
      return ok({ title: stamp, lines, empty: 'An empty note at this revision' });
    }
    const diff = await diffRevisions(deps, scope, screen.locator, { from: selected.id });
    if (!diff.ok) return diff;
    const lines =
      diff.value.patch === '' ? [] : diff.value.patch.trimEnd().split('\n').map(diffLine);
    return ok({
      title: `${stamp} → working file`,
      lines,
      empty: `No differences between ${abbreviate(selected.id)} and the working file`,
    });
  }, [wide, selected?.id, pane, tick, previewWidth]);
  const shown = preview.value ?? NO_PREVIEW;
  const scroll = clamp(screen.scroll ?? 0, shown.lines.length - previewHeight);

  const update = (patch: Partial<HistoryScreen>) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'history' ? { ...s, ...patch } : s) });
  };
  const moveTo = (c: number) => {
    update({ cursor: c, scroll: 0 });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) navigate({ type: 'pop' });
      else if (isDown(input, key)) moveTo(clamp(cursor + 1, revisions.length - 1));
      else if (isUp(input, key)) moveTo(clamp(cursor - 1, revisions.length - 1));
      else if (input === 'g') moveTo(0);
      else if (input === 'G') moveTo(Math.max(0, revisions.length - 1));
      else if (wide && (key.ctrl || key.pageDown || key.pageUp)) {
        const next = scrolledBy(input, key, scroll, shown.lines.length, previewHeight);
        if (next !== undefined) update({ scroll: next });
      } else if (wide && input === 'd') {
        update({ pane: pane === 'content' ? 'diff' : 'content', scroll: 0 });
      } else if (key.return || input === 'd') {
        if (!selected) {
          notify('No revision selected');
          return;
        }
        navigate({
          type: 'push',
          screen:
            input === 'd'
              ? { kind: 'diff', locator: screen.locator, from: selected.id, scroll: 0 }
              : { kind: 'revision', locator: screen.locator, revision: selected.id, scroll: 0 },
        });
      }
    },
    { isActive: !leader.pending },
  );

  const entry = history?.entry;
  const idText = entry && isNote(entry) ? entry.id : 'unidentified';
  const title = history
    ? `history · ${history.entry.title} · ${history.vault.config.name} · ${idText}`
    : 'history · loading…';
  const empty =
    loaded.state === 'error'
      ? `error: ${loaded.error.message}`
      : history?.status.kind === 'unversioned'
        ? `${history.entry.path} is not under version control`
        : history
          ? `No revisions recorded for ${history.entry.path}; press s in the note to save one`
          : 'loading…';
  const hints: Hint[] = wide
    ? [
        ['j/k', 'move'],
        ['d', pane === 'content' ? 'diff vs working' : 'content'],
        ['Ctrl-d/u', 'scroll preview'],
        ['Enter', 'full screen'],
        ['Space', 'menu'],
        ['Esc', 'back'],
      ]
    : [
        ['j/k', 'move'],
        ['Enter', 'view'],
        ['d', 'diff vs working'],
        ['Space', 'menu'],
        ['Esc', 'back'],
      ];
  const list = (
    <Rows
      header={['rev', 'date', 'author', 'summary']}
      rows={revisions.map(revisionRow)}
      roles={['accent', 'muted', 'muted', null]}
      cursor={cursor}
      height={height}
      empty={empty}
    />
  );
  return (
    <Frame title={title} hints={hints} overlay={leader.popup}>
      {wide ? (
        <Box flexDirection="row" height={height}>
          <Box flexDirection="column" width={listWidth} overflow="hidden">
            {list}
          </Box>
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
            <Text bold {...theme.paint('accent')} wrap="truncate">
              {shown.title === '' ? ' ' : shown.title}
            </Text>
            <ScrollText
              lines={shown.lines}
              scroll={scroll}
              height={previewHeight}
              empty={
                preview.state === 'error' && preview.value === undefined
                  ? `error: ${preview.error.message}`
                  : selected
                    ? preview.state === 'loading'
                      ? 'loading…'
                      : shown.empty
                    : ''
              }
            />
          </Box>
        </Box>
      ) : (
        list
      )}
    </Frame>
  );
};
