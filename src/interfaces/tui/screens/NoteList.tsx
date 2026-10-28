import { Text, useInput } from 'ink';
import { useState } from 'react';
import {
  createNote,
  previewTemplates,
  type TemplatePreview,
} from '../../../application/notes/create-note.js';
import { listNotes, type ScopedEntry } from '../../../application/notes/list-notes.js';
import { searchNotes } from '../../../application/search/search-notes.js';
import { screenChords, useLeader } from '../chords.js';
import { ok } from '../../../domain/result.js';
import { isComposite, resolveWriteTarget } from '../../../domain/scope/scope.js';
import { Dialog, DIALOG_CHROME } from '../components/Dialog.js';
import { Frame, useBodyHeight, type Hint } from '../components/Frame.js';
import { Prompt } from '../components/Prompt.js';
import { Rows } from '../components/Rows.js';
import { useLoad, useTui } from '../context.js';
import { isDown, isUp, scopeLabel } from '../keys.js';
import { clamp, locatorOfEntry, noteScreen, type Screen } from '../model.js';

type ListScreen = Extract<Screen, { kind: 'list' }>;
type PromptKind = 'search' | 'tag' | 'title';

/** After the title: the templates the target vault offers, each with the path it would write. */
interface TemplateChoice {
  readonly title: string;
  readonly templates: readonly TemplatePreview[];
  readonly cursor: number;
}

/** The start screen: browse, search, filter by tag, open; home panels by their keys. */
export const NoteList = ({ screen }: { readonly screen: ListScreen }) => {
  const tui = useTui();
  const { deps, scope, registry, revision, navigate, notify, report, quit, cwd, theme } = tui;
  const [prompt, setPrompt] = useState<PromptKind | null>(null);
  const [choice, setChoice] = useState<TemplateChoice | null>(null);
  const height = useBodyHeight();
  const leader = useLeader(screenChords(tui, { back: false }), prompt === null && choice === null);
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

  const create = async (title: string, template?: string) => {
    setChoice(null);
    const target = resolveWriteTarget(scope, { cwd });
    if (!target.ok) {
      report(target.error);
      return;
    }
    const created = await createNote(
      deps,
      target.value,
      { title, ...(template !== undefined && { template }) },
      registry.templates(),
    );
    if (!created.ok) {
      report(created.error);
      return;
    }
    notify(`Created ${created.value.id} at ${created.value.path}`);
    navigate({ type: 'push', screen: noteScreen({ query: created.value.id }) });
  };

  /** A title was given: offer the vault's templates (always at least `default`) with paths. */
  const startCreate = async (title: string) => {
    const target = resolveWriteTarget(scope, { cwd });
    if (!target.ok) {
      report(target.error);
      return;
    }
    const templates = await previewTemplates(deps, target.value, title, registry.templates());
    setChoice({ title, templates, cursor: 0 });
  };

  useInput(
    (input, key) => {
      if (!choice) return;
      const last = choice.templates.length - 1;
      if (key.escape) setChoice(null);
      else if (isDown(input, key)) setChoice({ ...choice, cursor: clamp(choice.cursor + 1, last) });
      else if (isUp(input, key)) setChoice({ ...choice, cursor: clamp(choice.cursor - 1, last) });
      else if (key.return) void create(choice.title, choice.templates[choice.cursor]?.name);
    },
    { isActive: choice !== null },
  );

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
      else if (input === 'c') setPrompt('title');
      else if (key.escape)
        navigate({ type: 'update', update: () => ({ kind: 'list', cursor: 0 }) });
      else if (input === 'q') quit();
    },
    { isActive: prompt === null && choice === null && !leader.pending },
  );

  const filters = [
    screen.search === undefined ? '' : ` · search: ${screen.search}`,
    screen.tag === undefined ? '' : ` · tag: ${screen.tag}`,
  ].join('');
  const title = choice
    ? `new note "${choice.title}" · choose a template`
    : `notes · ${scopeLabel(scope)}${filters}`;
  const meta = `${String(entries.length)} notes`;
  const hints: Hint[] = choice
    ? [
        ['j/k', 'move'],
        ['Enter', 'create'],
        ['Esc', 'cancel'],
      ]
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
    <Frame title={title} meta={meta} hints={hints} overlay={leader.popup}>
      {prompt && (
        <Dialog width={60}>
          <Prompt
            label={prompt === 'search' ? 'search:' : prompt === 'tag' ? 'tag:' : 'title:'}
            onCancel={() => {
              setPrompt(null);
            }}
            onSubmit={(value) => {
              setPrompt(null);
              const text = value.trim();
              if (prompt === 'search' || prompt === 'tag') filter(prompt, text);
              else if (text !== '') void startCreate(text);
            }}
          />
        </Dialog>
      )}
      {choice ? (
        <Dialog>
          <Rows
            header={['template', 'path']}
            rows={choice.templates.map((t) => [t.name, t.path])}
            roles={[null, 'muted']}
            cursor={choice.cursor}
            height={height - DIALOG_CHROME}
            empty="No templates"
          />
        </Dialog>
      ) : loaded.state === 'error' && loaded.value === undefined ? (
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
    </Frame>
  );
};
