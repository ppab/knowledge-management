import { useMemo } from 'react';
import { readRevision } from '../../../application/history/history.js';
import { isNote } from '../../../domain/note/note.js';
import { abbreviate } from '../../../domain/revision/revision.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import { ScrollText, useScrollKeys, type TextLine } from '../components/ScrollText.js';
import { useLoad, useTui } from '../context.js';
import { clamp, type Screen } from '../model.js';
import { revisionDate } from './History.js';

type RevisionScreen = Extract<Screen, { kind: 'revision' }>;

/** A note as it was at one revision: rendered like the viewer, but read-only. */
export const RevisionView = ({ screen }: { readonly screen: RevisionScreen }) => {
  const { deps, scope, revision: tick, columns, navigate } = useTui();
  const height = useBodyHeight();
  const loaded = useLoad(
    () => readRevision(deps, scope, screen.locator, screen.revision),
    [screen.locator, screen.revision, tick],
  );
  const historical = loaded.value;
  const lines: TextLine[] = useMemo(
    () =>
      historical
        ? deps.markdown
            .render(historical.entry.source, historical.entry.body.start, { width: columns })
            .map((line) => ({ text: line.spans.map((s) => s.text).join('') }))
        : [],
    [deps, historical, columns],
  );
  const scroll = clamp(screen.scroll, lines.length - height);

  useScrollKeys(
    scroll,
    lines.length,
    height,
    (next) => {
      navigate({
        type: 'update',
        update: (s) => (s.kind === 'revision' ? { ...s, scroll: next } : s),
      });
    },
    () => {
      navigate({ type: 'pop' });
    },
  );

  const entry = historical?.entry;
  const idText = entry && isNote(entry) ? entry.id : 'unidentified';
  const title = historical
    ? `${historical.entry.title} · ${historical.vault.config.name} · ${idText} @ ${abbreviate(historical.revision.id)} (${revisionDate(historical.revision)}) ${historical.revision.summary}`
    : 'revision · loading…';
  return (
    <Frame title={title} hints="j/k scroll  g/G top/bottom  b back">
      <ScrollText
        lines={lines}
        scroll={scroll}
        height={height}
        empty={loaded.state === 'error' ? `error: ${loaded.error.message}` : 'loading…'}
      />
    </Frame>
  );
};
