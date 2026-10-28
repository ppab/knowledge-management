import { Text, useInput } from 'ink';
import { useState } from 'react';
import { listNotes, type ScopedEntry } from '../../../application/notes/list-notes.js';
import { searchNotes } from '../../../application/search/search-notes.js';
import { screenChords, useLeader } from '../chords.js';
import { ok } from '../../../domain/result.js';
import { isComposite } from '../../../domain/scope/scope.js';
import { Dialog, DIALOG_CHROME } from '../components/Dialog.js';
import { Frame, useBodyHeight, type Hint } from '../components/Frame.js';
import { Prompt } from '../components/Prompt.js';
import { Rows } from '../components/Rows.js';
import { useLoad, useTui } from '../context.js';
import { isDown, isUp, scopeLabel } from '../keys.js';
import { clamp, locatorOfEntry, noteScreen, type Screen } from '../model.js';
import { useCreateFlow } from './create-flow.js';

type ListScreen = Extract<Screen, { kind: 'list' }>;
type PromptKind = 'search' | 'tag';

/** The start screen: browse, search, filter by tag, open; home panels by their keys. */
export const NoteList = ({ screen }: { readonly screen: ListScreen }) => {
  const tui = useTui();
  const { deps, scope, revision, navigate, quit, theme } = tui;
  const [prompt, setPrompt] = useState<PromptKind | null>(null);
  const create = useCreateFlow();
  const height = useBodyHeight();
  const leader = useLeader(screenChords(tui, { back: false }), prompt === null && !create.active);
  const composite = isComposite(scope);

  const loaded = useLoad(async () => {
    if (screen.search !== undefined) {
      const hits = await searchNotes(deps, scope, screen.search);
      if (!hits.ok) return hits;
      return ok(hits.value.map((hit): ScopedEntry => ({ ...hit.entry, vault: hit.vault })));
    }
    return listNotes(deps, scope, screen.tag === undefined ? {} : { tag: screen.tag });
  }, [screen.search, screen.tag, revision]);
  const entries = loaded.value ?? [];
  const cursor = clamp(screen.cursor, entries.length - 1);

  const update = (patch: Partial<ListScreen>) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'list' ? { ...s, ...patch } : s) });
  };

  /** Sets or (with empty text) clears a filter and goes back to the top. */
  const filter = (which: 'search' | 'tag', text: string) => {
    navigate({
      type: 'update',
      update: (s) => {
        if (s.kind !== 'list') return s;
        const { search: _search, tag: _tag, ...rest } = s;
        const kept = which === 'search' ? { tag: s.tag } : { search: s.search };
        return {
          ...rest,
          cursor: 0,
          ...(kept.tag !== undefined && { tag: kept.tag }),
          ...(kept.search !== undefined && { search: kept.search }),
          ...(text !== '' && { [which]: text }),
        };
      },
    });
  };

  useInput(
    (input, key) => {
      if (isDown(input, key)) update({ cursor: clamp(cursor + 1, entries.length - 1) });
      else if (isUp(input, key)) update({ cursor: clamp(cursor - 1, entries.length - 1) });
      else if (input === 'g') update({ cursor: 0 });
      else if (input === 'G') update({ cursor: Math.max(0, entries.length - 1) });
      else if (key.return) {
        const entry = entries[cursor];
        if (entry) navigate({ type: 'push', screen: noteScreen(locatorOfEntry(entry)) });
      } else if (input === '/') setPrompt('search');
      else if (input === 't') setPrompt('tag');
      else if (input === 'c') create.start();
      else if (key.escape)
        navigate({ type: 'update', update: () => ({ kind: 'list', cursor: 0 }) });
      else if (input === 'q') quit();
    },
    { isActive: prompt === null && !create.active && !leader.pending },
  );

  const filters = [
    screen.search === undefined ? '' : ` · search: ${screen.search}`,
    screen.tag === undefined ? '' : ` · tag: ${screen.tag}`,
  ].join('');
  const title = create.active ? create.title : `notes · ${scopeLabel(scope)}${filters}`;
  const meta = create.active ? undefined : `${String(entries.length)} notes`;
  const hints: readonly Hint[] = create.active
    ? create.hints
    : [
        ['j/k', 'move'],
        ['Enter', 'open'],
        ['/', 'search'],
        ['t', 'tag'],
        ['c', 'create'],
        ['Space', 'menu'],
        ['Esc', 'clear'],
        ['q', 'quit'],
      ];

  const rows = entries.map((e) => [
    e.kind === 'note' ? e.id : '-',
    e.title,
    ...(composite ? [e.vault] : []),
    e.tags.join(','),
  ]);
  const header = ['id', 'title', ...(composite ? ['vault'] : []), 'tags'];

  return (
    <Frame title={title} {...(meta !== undefined && { meta })} hints={hints} overlay={leader.popup}>
      {create.active ? (
        create.view
      ) : (
        <>
          {prompt && (
            <Dialog width={60}>
              <Prompt
                label={prompt === 'search' ? 'search:' : 'tag:'}
                onCancel={() => {
                  setPrompt(null);
                }}
                onSubmit={(value) => {
                  setPrompt(null);
                  filter(prompt, value.trim());
                }}
              />
            </Dialog>
          )}
          {loaded.state === 'error' && loaded.value === undefined ? (
            <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>
          ) : (
            <Rows
              header={header}
              rows={rows}
              roles={['muted', null, ...(composite ? ['muted' as const] : []), 'tag']}
              cursor={cursor}
              height={height - (prompt ? 1 + DIALOG_CHROME : 0)}
              empty={loaded.state === 'loading' ? 'loading…' : 'No notes.'}
            />
          )}
        </>
      )}
    </Frame>
  );
};
