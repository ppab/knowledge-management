import { useMemo } from 'react';
import { diffRevisions } from '../../../application/history/history.js';
import { abbreviate } from '../../../domain/revision/revision.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import { ScrollText, useScrollKeys, type TextLine } from '../components/ScrollText.js';
import { useLoad, useTui } from '../context.js';
import { clamp, type Screen } from '../model.js';

type DiffScreen = Extract<Screen, { kind: 'diff' }>;

/** Colours a unified diff line the way `git diff` does. */
export const diffLine = (text: string): TextLine => {
  if (text.startsWith('+++') || text.startsWith('---')) return { text, dim: true };
  if (text.startsWith('@@')) return { text, color: 'cyan' };
  if (text.startsWith('+')) return { text, color: 'green' };
  if (text.startsWith('-')) return { text, color: 'red' };
  if (text.startsWith('\\')) return { text, dim: true };
  return { text };
};

/** A recorded revision against the working file. */
export const DiffView = ({ screen }: { readonly screen: DiffScreen }) => {
  const { deps, scope, revision: tick, navigate } = useTui();
  const height = useBodyHeight();
  const loaded = useLoad(
    () => diffRevisions(deps, scope, screen.locator, { from: screen.from }),
    [screen.locator, screen.from, tick],
  );
  const diff = loaded.value;
  const lines = useMemo(
    () => (diff && diff.patch !== '' ? diff.patch.trimEnd().split('\n').map(diffLine) : []),
    [diff],
  );
  const scroll = clamp(screen.scroll, lines.length - height);

  useScrollKeys(
    scroll,
    lines.length,
    height,
    (next) => {
      navigate({ type: 'update', update: (s) => (s.kind === 'diff' ? { ...s, scroll: next } : s) });
    },
    () => {
      navigate({ type: 'pop' });
    },
  );

  const title = diff
    ? `diff · ${diff.entry.title} · ${abbreviate(diff.from.id)} → working file`
    : 'diff · loading…';
  return (
    <Frame title={title} hints="j/k scroll  g/G top/bottom  Esc back">
      <ScrollText
        lines={lines}
        scroll={scroll}
        height={height}
        empty={
          loaded.state === 'error'
            ? `error: ${loaded.error.message}`
            : diff
              ? `No differences between ${abbreviate(diff.from.id)} and the working file`
              : 'loading…'
        }
      />
    </Frame>
  );
};
