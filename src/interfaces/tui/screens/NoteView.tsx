import { Box, Text, useApp, useInput, type Key } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { revisionStatus } from '../../../application/history/history.js';
import { saveNote, type SaveOutcome } from '../../../application/history/save-note.js';
import {
  checkSelection,
  wrapSelectionAsExternalLink,
  wrapSelectionAsReference,
} from '../../../application/mutations/wrap-selection.js';
import {
  referenceDisplay,
  renderNote,
  viewNote,
  type ViewedNote,
} from '../../../application/notes/view-note.js';
import type { PanelData, PanelSpec } from '../../../application/plugin/plugin.js';
import {
  addReference,
  checkInsertionPoint,
} from '../../../application/references/add-reference.js';
import type { Resolution } from '../../../application/references/references.js';
import { removeReference } from '../../../application/references/remove-reference.js';
import { readRevision } from '../../../application/history/history.js';
import { changedLines, lineNumberAt } from '../../../domain/text/diff.js';
import { firstSourceOffset } from '../../../domain/text/rendered.js';
import { isNote } from '../../../domain/note/note.js';
import type { AppError } from '../../../domain/errors.js';
import { ok, type Result } from '../../../domain/result.js';
import { abbreviate, isUnsaved, type RevisionStatus } from '../../../domain/revision/revision.js';
import type { InsertionLocation } from '../../../domain/text/insertion.js';
import {
  comparePositions,
  referenceAt,
  referencePositions,
  selectedRange,
  sourceOffsetAt,
  type Position,
  type Span,
} from '../../../domain/text/rendered.js';
import type { SourceRange } from '../../../domain/text/text-edit.js';
import { absoluteNotePath } from '../../../domain/vault/paths.js';
import { screenChords, useLeader, type Chord } from '../chords.js';
import { Dialog } from '../components/Dialog.js';
import { Frame, useBodyHeight, type Hint } from '../components/Frame.js';
import { LocationPrompt } from '../components/LocationPrompt.js';
import { actionHints, PanelView } from '../components/PanelView.js';
import { Picker, type Picked } from '../components/Picker.js';
import { Prompt } from '../components/Prompt.js';
import { useLoad, useTui, type Loaded } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import type { Role } from '../theme.js';
import { clamp, locatorOf, noteScreen, type Screen } from '../model.js';
import { apiForPanel, noteAt, outcomeText, panelApplies, rowAt, rowCount } from '../panels.js';
import {
  clampPosition,
  firstTextPosition,
  highlight,
  move,
  type Motion,
  type Selection,
} from '../selection.js';

type NoteScreen = Extract<Screen, { kind: 'note' }>;

/** A modal step that owns the keyboard: picking a target, a location, or typing a URL. */
type Flow =
  | { readonly kind: 'pick'; readonly purpose: 'insert' }
  | {
      readonly kind: 'pick';
      readonly purpose: 'at';
      readonly offset: number;
      readonly side: 'before' | 'after';
      readonly version: string;
    }
  | { readonly kind: 'pick'; readonly purpose: 'wrap'; readonly range: SourceRange }
  | { readonly kind: 'locate'; readonly target: Picked }
  | { readonly kind: 'url'; readonly range: SourceRange }
  | { readonly kind: 'save' };

const PANEL_WIDTH = 36;

/** `●` marks a file that differs from its last recorded revision (or has none yet). */
const modifiedMarker = (status: RevisionStatus | undefined): string =>
  status && isUnsaved(status) ? ' ●' : '';

const saveText = (path: string, outcome: SaveOutcome): string => {
  switch (outcome.kind) {
    case 'saved':
      return `Saved revision ${abbreviate(outcome.revision.id)}: ${outcome.revision.summary}`;
    case 'nothing-to-save':
      return `Nothing to save: ${path} matches revision ${abbreviate(outcome.last.id)}`;
    case 'not-under-version-control':
      return `Nothing saved: ${path} is not under version control`;
  }
};

const referenceRole = (resolution: Resolution | undefined): Role | null => {
  switch (resolution?.state) {
    case 'resolved':
      return 'link';
    case 'unresolved':
      return 'error';
    case 'ambiguous':
      return 'warn';
    case 'unavailable':
      return 'unavailable';
    default:
      return null;
  }
};

const whyNotFollowed = (resolution: Resolution, target: string): string => {
  switch (resolution.state) {
    case 'resolved':
      return '';
    case 'unresolved':
      return `Reference [[${target}]] is unresolved: no note has that id`;
    case 'ambiguous':
      return `Reference [[${target}]] is ambiguous: ${resolution.candidates
        .map((c) => `${c.vault}:${c.path}`)
        .join(', ')}`;
    case 'unavailable':
      return `Reference [[${target}]] cannot be resolved: vault(s) unavailable: ${resolution.vaults.join(', ')}`;
  }
};

/** vim's motions, identical in normal and select mode; `b` is word back, never "back". */
const MOTION_KEYS: Readonly<Record<string, Motion>> = {
  h: 'left',
  l: 'right',
  j: 'down',
  k: 'up',
  w: 'wordForward',
  b: 'wordBack',
  e: 'wordEnd',
  '0': 'lineStart',
  '^': 'lineStart',
  $: 'lineEnd',
  '{': 'paragraphBack',
  '}': 'paragraphForward',
};

const motionOf = (input: string, key: Key): Motion | undefined => {
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  return MOTION_KEYS[input];
};

const SpanText = ({
  span,
  viewed,
  underCursor,
  selected,
}: {
  readonly span: Span;
  readonly viewed: ViewedNote;
  /** The reference the cursor sits on; drawn whole. */
  readonly underCursor: number | null;
  readonly selected: boolean;
}) => {
  const { theme } = useTui();
  const style = span.style ?? {};
  if (span.reference !== undefined) {
    const resolution = viewed.references[span.reference]?.resolution;
    const role = referenceRole(resolution);
    return (
      <Text
        {...(role === null ? {} : theme.paint(role))}
        underline={resolution?.state === 'resolved'}
        inverse={selected || span.reference === underCursor}
      >
        {span.text}
      </Text>
    );
  }
  return (
    <Text
      bold={style.bold === true}
      italic={style.italic === true}
      strikethrough={style.strikethrough === true}
      dimColor={style.dim === true && !selected}
      underline={style.link === true}
      inverse={selected}
      {...(style.code
        ? theme.paint('code')
        : style.heading !== undefined
          ? theme.paint('heading')
          : {})}
    >
      {span.text}
    </Text>
  );
};

/**
 * Reads a note and moves a text cursor over it: follow the reference under it, select from
 * it, insert next to it; side panels and the editor handoff as in M5.
 */
export const NoteView = ({ screen }: { readonly screen: NoteScreen }) => {
  const tui = useTui();
  const { deps, scope, registry, editor, revision, columns, navigate, notify, report, theme } = tui;
  const { suspendTerminal } = useApp();
  const [local, setLocal] = useState(0);
  const [editing, setEditing] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const height = useBodyHeight();

  const loaded = useLoad(
    () => viewNote(deps, scope, screen.locator),
    [screen.locator, revision, local],
  );
  const viewed = loaded.value;
  const entry = viewed?.entry;
  const located = viewed?.located;
  const selection = screen.selection;

  // The marker follows the file: any reload (edit, save, watcher tick) re-asks the provider.
  const statusLoaded = useLoad(
    () => revisionStatus(deps, scope, screen.locator),
    [screen.locator, entry?.version, revision, local],
  );
  const status = statusLoaded.value?.status;

  // Side panels: those that apply to this note; the automatic one has no key.
  const panels = useMemo(
    () =>
      located
        ? registry.panels('note').filter((p) => panelApplies(registry, p, located.note.type))
        : [],
    [registry, located],
  );
  const autoPanel = panels.find((p) => p.chord === undefined);
  const panelId = screen.panel === undefined ? autoPanel?.id : screen.panel;
  const panel: PanelSpec | undefined = panels.find((p) => p.id === panelId);
  const panelFocused = panel !== undefined && screen.panel !== undefined;
  const focusedPanel = panelFocused ? panel : undefined;

  const panelLoaded: Loaded<PanelData> = useLoad(
    () =>
      panel && located
        ? panel.load(apiForPanel(tui, panel), { note: located })
        : Promise.resolve(ok<PanelData>({ kind: 'text', lines: [] })),
    [panel?.id, located?.note.version, revision, local],
  );
  const panelData = panel ? panelLoaded.value : undefined;

  // Note panels toggle under the leader (`Space m`, `Space B`, plugin chords); home chords too.
  const panelChords = panels
    .filter((p) => p.chord !== undefined)
    .map((p): Chord => ({
      key: p.chord ?? '',
      label: p.title.toLowerCase(),
      run: () => {
        update({ panel: panelId === p.id ? null : p.id, panelCursor: 0 });
      },
    }));
  const leader = useLeader(
    screenChords(tui, { back: true, extra: panelChords }),
    flow === null && !selection,
  );
  const half = Math.max(1, Math.floor(height / 2));

  // In a versioned vault a two-cell gutter marks lines changed since the last saved revision.
  const gutter = status !== undefined && status.kind !== 'unversioned';
  const lastSaved = status?.kind === 'modified' ? status.last : undefined;
  const savedLoaded = useLoad(
    () =>
      lastSaved
        ? readRevision(deps, scope, screen.locator, lastSaved.id)
        : Promise.resolve(ok(null)),
    [screen.locator, lastSaved?.id, revision, local],
  );
  const changes = useMemo(() => {
    const saved = savedLoaded.value;
    return saved && viewed ? changedLines(saved.entry.source, viewed.entry.source) : null;
  }, [savedLoaded.value, viewed]);
  const bodyWidth = Math.max(10, columns - (panel ? PANEL_WIDTH + 1 : 0) - (gutter ? 2 : 0));
  const lines = useMemo(
    () => (viewed ? renderNote(deps, viewed, bodyWidth) : []),
    [deps, viewed, bodyWidth],
  );
  const maxScroll = Math.max(0, lines.length - height);
  const scroll = clamp(screen.scroll, maxScroll);
  // The cursor rests on the first text until moved; reloads and resizes keep it in bounds.
  const cursor: Position = useMemo(
    () =>
      clampPosition(lines, screen.cursor ?? firstTextPosition(lines, 0) ?? { line: 0, column: 0 }),
    [lines, screen.cursor],
  );
  const cursorLine = lines[cursor.line];
  const underCursor = cursorLine ? referenceAt(cursorLine, cursor.column) : null;

  const update = (patch: Partial<NoteScreen>) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'note' ? { ...s, ...patch } : s) });
  };
  /** Ends selection mode; the cursor stays where the head was. */
  const clearSelection = () => {
    navigate({
      type: 'update',
      update: (s) => {
        if (s.kind !== 'note') return s;
        const { selection: _selection, ...rest } = s;
        return _selection ? { ...rest, cursor: _selection.head } : rest;
      },
    });
  };

  /** The first row to show so that `line` is on screen, moving as little as possible. */
  const follow = (line: number, from = scroll): number =>
    clamp(line < from ? line : line >= from + height ? line - height + 1 : from, maxScroll);

  const placeCursor = (next: Position, from = scroll) => {
    update({ cursor: next, scroll: follow(next.line, from) });
  };

  // A reload that brought another version makes the selection's offsets meaningless.
  const version = viewed?.entry.version;
  useEffect(() => {
    if (selection && version !== undefined && version !== selection.version) {
      clearSelection();
      setFlow(null);
      notify('Selection cleared: the note changed on disk', 'error');
    }
    // Only the versions matter; the callbacks are stable for the life of the screen.
  }, [version, selection?.version]);

  const reload = () => {
    setLocal((n) => n + 1);
  };

  /** `Tab`/`Shift-Tab`: the cursor jumps to the next or previous reference, wrapping. */
  const moveReference = (delta: number) => {
    const positions = referencePositions(lines);
    const next =
      delta > 0
        ? (positions.find((p) => comparePositions(p, cursor) > 0) ?? positions[0])
        : (positions.findLast((p) => comparePositions(p, cursor) < 0) ?? positions.at(-1));
    if (!next) {
      notify('No references in this note');
      return;
    }
    placeCursor({ line: next.line, column: next.column });
  };

  const followReference = () => {
    const ref = underCursor === null ? undefined : viewed?.references[underCursor];
    if (!ref) {
      notify('No reference under the cursor');
      return;
    }
    if (ref.resolution.state === 'resolved') {
      navigate({ type: 'push', screen: noteScreen({ query: ref.target }) });
    } else {
      notify(whyNotFollowed(ref.resolution, ref.target), 'error');
    }
  };

  /** `x`: the reference under the cursor goes; a labelled one leaves its label as prose. */
  const removeUnderCursor = () => {
    const ref = underCursor === null ? undefined : viewed?.references[underCursor];
    if (!ref || !located) {
      notify('No reference under the cursor');
      return;
    }
    const shown = referenceDisplay(ref);
    void mutate(
      removeReference(deps, scope, {
        source: located.note.id,
        range: ref.range,
        expectedVersion: located.note.version,
      }),
      ref.label === undefined || ref.label === ''
        ? `Removed reference to ${shown}`
        : `Unlinked "${shown}"; the text stays`,
      undefined,
    );
  };

  const edit = async () => {
    if (!viewed || editing) return;
    setEditing(true);
    const file = absoluteNotePath(viewed.vault.root, viewed.entry.path);
    const command = viewed.vault.config.editor;
    let result: Result<void, AppError> = ok(undefined);
    try {
      await suspendTerminal(async () => {
        result = await editor.open(file, command === undefined ? {} : { command });
      });
    } catch (cause: unknown) {
      notify(`Editor handoff failed: ${String(cause)}`, 'error');
    }
    setEditing(false);
    if (!result.ok) report(result.error);
    reload();
  };

  const runAction = async (key: string) => {
    const action = panel?.actions?.find((a) => a.key === key);
    if (!action || !panel) return false;
    const outcome = await action.run(apiForPanel(tui, panel), {
      ...(located && { note: located }),
      selection: rowAt(panelData, screen.panelCursor),
    });
    if (outcome.ok) notify(outcomeText(outcome.value));
    else report(outcome.error);
    reload();
    return true;
  };

  /** Only identified notes can be mutated or referenced. */
  const identified = (): boolean => {
    if (located) return true;
    notify('This file has no id; adopt it before adding references', 'error');
    return false;
  };

  const startSelection = () => {
    if (!identified() || !located) return;
    if (lines.length === 0) {
      notify('Nothing to select in this note');
      return;
    }
    update({ selection: { anchor: cursor, head: cursor, version: located.note.version } });
  };

  /** `i`/`a`: a reference next to the word under the cursor, target from the picker. */
  const insertAtCursor = (side: 'before' | 'after') => {
    if (!identified() || !located) return;
    const offset = cursorLine ? sourceOffsetAt(cursorLine, cursor.column) : null;
    if (offset === null) {
      notify('Put the cursor on note text first', 'error');
      return;
    }
    const version = located.note.version;
    void checkInsertionPoint(deps, scope, {
      source: located.note.id,
      at: { kind: 'at', offset, side },
      expectedVersion: version,
    }).then((checked) => {
      if (checked.ok) setFlow({ kind: 'pick', purpose: 'at', offset, side, version });
      else report(checked.error);
    });
  };

  /** Keeps the head on screen as it moves. */
  const extend = (current: Selection, motion: Motion) => {
    const head = move(lines, current.head, motion);
    update({ selection: { ...current, head }, scroll: follow(head.line) });
  };

  /** The selection as source offsets, checked against the single-text-node rule. */
  const rangeOf = async (current: Selection): Promise<SourceRange | null> => {
    if (!located) return null;
    const range = selectedRange(lines, current.anchor, current.head);
    if (!range.ok) {
      report(range.error);
      return null;
    }
    const checked = await checkSelection(deps, scope, {
      note: located.note.id,
      selection: range.value,
      expectedVersion: current.version,
    });
    if (!checked.ok) {
      // Navigation clears the status line, so drop the selection before reporting.
      if (checked.error.code === 'CONFLICT') clearSelection();
      report(checked.error);
      return null;
    }
    return range.value;
  };

  const selectionKey = (current: Selection, input: string, key: Key) => {
    const motion = motionOf(input, key);
    if (key.escape) clearSelection();
    else if (motion) extend(current, motion);
    else if (input === 'v') update({ selection: { ...current, anchor: current.head } });
    else if (input === 'r' || input === 'u') {
      void rangeOf(current).then((range) => {
        if (!range) return;
        setFlow(input === 'r' ? { kind: 'pick', purpose: 'wrap', range } : { kind: 'url', range });
      });
    }
  };

  /** Runs a mutation of the note, reports, and reloads on success. */
  const mutate = async (
    work: Promise<Result<unknown, AppError>>,
    done: string,
    current: Selection | undefined,
  ) => {
    setFlow(null);
    const outcome = await work;
    if (!outcome.ok) {
      if (outcome.error.code === 'CONFLICT') clearSelection();
      report(outcome.error);
      return;
    }
    if (current) clearSelection();
    notify(done);
    reload();
  };

  const selectedText = (range: SourceRange): string =>
    viewed ? viewed.entry.source.slice(range.start, range.end) : '';

  const onPicked = (picked: Picked) => {
    if (flow?.kind !== 'pick' || !located) return;
    if (flow.purpose === 'insert') {
      setFlow({ kind: 'locate', target: picked });
      return;
    }
    if (flow.purpose === 'at') {
      void mutate(
        addReference(deps, scope, {
          source: located.note.id,
          target: picked.id,
          at: { kind: 'at', offset: flow.offset, side: flow.side },
          expectedVersion: flow.version,
        }),
        `Added reference to ${picked.title}`,
        undefined,
      );
      return;
    }
    const { range } = flow;
    void mutate(
      wrapSelectionAsReference(deps, scope, {
        note: located.note.id,
        selection: range,
        target: picked.id,
        ...(selection && { expectedVersion: selection.version }),
      }),
      `Linked "${selectedText(range)}" to ${picked.title}`,
      selection,
    );
  };

  const onLocated = (at: InsertionLocation) => {
    if (flow?.kind !== 'locate' || !located) return;
    void mutate(
      addReference(deps, scope, {
        source: located.note.id,
        target: flow.target.id,
        at,
        expectedVersion: located.note.version,
      }),
      `Added reference to ${flow.target.title}`,
      undefined,
    );
  };

  const onSave = (message: string) => {
    setFlow(null);
    void saveNote(deps, scope, screen.locator, { message }).then((saved) => {
      if (saved.ok) notify(saveText(saved.value.entry.path, saved.value.outcome));
      else report(saved.error);
      reload();
    });
  };

  const onUrl = (url: string) => {
    if (flow?.kind !== 'url' || !located) return;
    const trimmed = url.trim();
    if (trimmed === '') {
      setFlow(null);
      return;
    }
    void mutate(
      wrapSelectionAsExternalLink(deps, scope, {
        note: located.note.id,
        selection: flow.range,
        url: trimmed,
        ...(selection && { expectedVersion: selection.version }),
      }),
      `Linked "${selectedText(flow.range)}" to ${trimmed}`,
      selection,
    );
  };

  useInput(
    (input, key) => {
      if (selection) {
        selectionKey(selection, input, key);
        return;
      }
      if (key.escape && panelFocused) {
        update({ panel: null, panelCursor: 0 });
        return;
      }
      if (isBack(input, key)) {
        navigate({ type: 'pop' });
        return;
      }
      if (input === 'o') return void edit();
      if (input === 'x') {
        removeUnderCursor();
        return;
      }
      if (input === 's') {
        setFlow({ kind: 'save' });
        return;
      }
      if (input === 'H') {
        navigate({ type: 'push', screen: { kind: 'history', locator: screen.locator, cursor: 0 } });
        return;
      }
      if (input === 'I') {
        if (identified()) setFlow({ kind: 'pick', purpose: 'insert' });
        return;
      }
      if (input === 'i' || input === 'a') {
        insertAtCursor(input === 'i' ? 'before' : 'after');
        return;
      }
      if (input === 'v') {
        startSelection();
        return;
      }
      if (panelFocused) {
        const rows = rowCount(panelData);
        if (isDown(input, key)) {
          update({ panelCursor: clamp(screen.panelCursor + 1, rows - 1) });
          return;
        }
        if (isUp(input, key)) {
          update({ panelCursor: clamp(screen.panelCursor - 1, rows - 1) });
          return;
        }
        if (key.return) {
          const ref = noteAt(panelData, screen.panelCursor);
          if (ref) navigate({ type: 'push', screen: noteScreen(locatorOf(ref)) });
          else notify('Nothing to open on this row');
          return;
        }
        void runAction(input);
        return;
      }
      const motion = motionOf(input, key);
      const page = key.ctrl ? { f: height, b: -height, d: half, u: -half }[input] : undefined;
      if (motion) placeCursor(move(lines, cursor, motion));
      else if (key.pageDown || key.pageUp || page !== undefined) {
        const delta = page ?? (key.pageUp ? -height : height);
        placeCursor(
          clampPosition(lines, { line: cursor.line + delta, column: cursor.column }),
          clamp(scroll + delta, maxScroll),
        );
      } else if (input === 'g') placeCursor(firstTextPosition(lines, 0) ?? { line: 0, column: 0 });
      else if (input === 'G')
        placeCursor(clampPosition(lines, { line: lines.length - 1, column: 0 }));
      else if (key.tab) moveReference(key.shift ? -1 : 1);
      else if (key.return) followReference();
    },
    { isActive: flow === null && !leader.pending },
  );

  const idText = entry && isNote(entry) ? entry.id : 'unidentified';
  const typeText = entry && isNote(entry) && entry.type !== undefined ? ` · ${entry.type}` : '';
  const title = viewed
    ? `${viewed.entry.title} · ${viewed.vault.config.name} · ${idText}${typeText}${modifiedMarker(status)}`
    : 'loading…';
  const cancel: Hint = ['Esc', 'cancel'];
  const { hints, mode }: { hints: Hint[]; mode?: string } =
    flow?.kind === 'pick'
      ? { hints: [['', 'type to search'], ['↑/↓', 'move'], ['Enter', 'pick'], cancel] }
      : flow?.kind === 'locate'
        ? { hints: [['j/k', 'move'], ['Enter', 'insert'], cancel] }
        : flow?.kind === 'url'
          ? { hints: [['Enter', 'link'], cancel] }
          : flow?.kind === 'save'
            ? { hints: [['Enter', 'save (empty message: "save <title>")'], cancel] }
            : selection
              ? {
                  mode: 'select',
                  hints: [
                    ['hjkl/w/b/e', 'move'],
                    ['0/$', 'line'],
                    ['v', 'restart'],
                    ['r', 'reference'],
                    ['u', 'url'],
                    cancel,
                  ],
                }
              : focusedPanel
                ? {
                    mode: 'panel',
                    hints: [
                      ['j/k', 'move'],
                      ['Enter', 'open'],
                      ...actionHints(focusedPanel),
                      ['Esc', 'close'],
                    ],
                  }
                : {
                    hints: [
                      ['hjkl/w/b/e', 'move'],
                      ['i/a/I', 'ref'],
                      ['x', 'unref'],
                      ['v', 'select'],
                      ['o', 'edit'],
                      ['s', 'save'],
                      ['H', 'history'],
                      ['Space', 'menu'],
                      ['Esc', 'back'],
                    ],
                  };

  const visible = lines.slice(scroll, scroll + height);
  const body =
    loaded.state === 'error' && !viewed ? (
      <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>
    ) : viewed ? (
      visible.map((line, i) => {
        const pieces = highlight(line, scroll + i, selection ?? { anchor: cursor, head: cursor });
        const offset = changes ? firstSourceOffset(line) : null;
        const at = offset === null ? null : lineNumberAt(viewed.entry.source, offset);
        const mark =
          at !== null && changes?.added.has(at)
            ? (['▎ ', 'ok'] as const)
            : at !== null && changes?.deletedBefore.has(at)
              ? (['▁ ', 'error'] as const)
              : null;
        return (
          <Text key={scroll + i} wrap="truncate">
            {gutter && (mark ? <Text {...theme.paint(mark[1])}>{mark[0]}</Text> : '  ')}
            {pieces.length === 0
              ? ' '
              : pieces.map((piece, j) => (
                  <SpanText
                    key={j}
                    span={piece.span}
                    viewed={viewed}
                    underCursor={underCursor}
                    selected={piece.selected}
                  />
                ))}
          </Text>
        );
      })
    ) : (
      <Text dimColor>loading…</Text>
    );

  return (
    <Frame title={title} hints={hints} {...(mode !== undefined && { mode })} overlay={leader.popup}>
      {flow?.kind === 'pick' ? (
        <Picker
          height={height}
          onPick={onPicked}
          onCancel={() => {
            setFlow(null);
          }}
        />
      ) : flow?.kind === 'locate' ? (
        <LocationPrompt
          target={flow.target.title}
          headings={located?.note.headings ?? []}
          height={height}
          onPick={onLocated}
          onCancel={() => {
            setFlow(null);
          }}
        />
      ) : (
        <Box flexDirection="row" height={height}>
          <Box flexDirection="column" width={bodyWidth} overflow="hidden">
            {flow?.kind === 'url' || flow?.kind === 'save' ? (
              <Dialog width={60}>
                <Prompt
                  label={flow.kind === 'url' ? 'url:' : 'save message:'}
                  onSubmit={flow.kind === 'url' ? onUrl : onSave}
                  onCancel={() => {
                    setFlow(null);
                  }}
                />
              </Dialog>
            ) : null}
            {body}
          </Box>
          {panel && (
            <Box
              flexDirection="column"
              width={PANEL_WIDTH + 1}
              borderStyle="single"
              borderLeft
              borderTop={false}
              borderRight={false}
              borderBottom={false}
              borderDimColor
              paddingLeft={1}
              overflow="hidden"
            >
              <Text bold={panelFocused} dimColor={!panelFocused} {...theme.paint('accent')}>
                {panel.title}
              </Text>
              <PanelView
                spec={panel}
                loaded={panelLoaded}
                cursor={panelFocused ? screen.panelCursor : -1}
                height={height - 1}
              />
            </Box>
          )}
        </Box>
      )}
    </Frame>
  );
};
