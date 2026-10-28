import { useInput } from 'ink';
import { listRevisions } from '../../../application/history/history.js';
import { isNote } from '../../../domain/note/note.js';
import { abbreviate, type Revision } from '../../../domain/revision/revision.js';
import { screenChords, useLeader } from '../chords.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import { Rows } from '../components/Rows.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, type Screen } from '../model.js';

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

/** The recorded revisions of a note: `Enter` reads one, `d` diffs it against the working file. */
export const History = ({ screen }: { readonly screen: HistoryScreen }) => {
  const tui = useTui();
  const { deps, scope, revision: tick, navigate, notify } = tui;
  const height = useBodyHeight();
  const leader = useLeader(screenChords(tui), true);
  const loaded = useLoad(() => listRevisions(deps, scope, screen.locator), [screen.locator, tick]);
  const history = loaded.value;
  const revisions = history?.revisions ?? [];
  const cursor = clamp(screen.cursor, revisions.length - 1);

  const update = (c: number) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'history' ? { ...s, cursor: c } : s) });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) navigate({ type: 'pop' });
      else if (isDown(input, key)) update(clamp(cursor + 1, revisions.length - 1));
      else if (isUp(input, key)) update(clamp(cursor - 1, revisions.length - 1));
      else if (input === 'g') update(0);
      else if (input === 'G') update(Math.max(0, revisions.length - 1));
      else if (key.return || input === 'd') {
        const picked = revisions[cursor];
        if (!picked) {
          notify('No revision selected');
          return;
        }
        navigate({
          type: 'push',
          screen:
            input === 'd'
              ? { kind: 'diff', locator: screen.locator, from: picked.id, scroll: 0 }
              : { kind: 'revision', locator: screen.locator, revision: picked.id, scroll: 0 },
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
  return (
    <Frame
      title={title}
      hints={[
        ['j/k', 'move'],
        ['Enter', 'view'],
        ['d', 'diff vs working'],
        ['Space', 'menu'],
        ['Esc', 'back'],
      ]}
      overlay={leader.popup}
    >
      <Rows
        header={['rev', 'date', 'author', 'summary']}
        rows={revisions.map(revisionRow)}
        roles={['accent', 'muted', 'muted', null]}
        cursor={cursor}
        height={height}
        empty={empty}
      />
    </Frame>
  );
};
