import { Box, Text, useApp, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { renderNote, viewNote, type ViewedNote } from '../../../application/notes/view-note.js';
import type { PanelData, PanelSpec } from '../../../application/plugin/plugin.js';
import type { Resolution } from '../../../application/references/references.js';
import { isNote } from '../../../domain/note/note.js';
import type { AppError } from '../../../domain/errors.js';
import { ok, type Result } from '../../../domain/result.js';
import { findReferenceSpan, type Span } from '../../../domain/text/rendered.js';
import { absoluteNotePath } from '../../../domain/vault/paths.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import { actionHints, PanelView } from '../components/PanelView.js';
import { useLoad, useTui, type Loaded } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, locatorOf, noteScreen, type Screen } from '../model.js';
import { apiForPanel, noteAt, outcomeText, panelApplies, rowAt, rowCount } from '../panels.js';

type NoteScreen = Extract<Screen, { kind: 'note' }>;

const PANEL_WIDTH = 36;

/** `●` marks a file that differs from its last recorded revision; M7 wires the revisions in. */
const modifiedMarker = (_viewed: ViewedNote): string => '';

const referenceColor = (resolution: Resolution | undefined): string => {
  switch (resolution?.state) {
    case 'resolved':
      return 'cyan';
    case 'unresolved':
      return 'red';
    case 'ambiguous':
      return 'yellow';
    case 'unavailable':
      return 'magenta';
    default:
      return 'white';
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

const SpanText = ({
  span,
  viewed,
  cursor,
}: {
  readonly span: Span;
  readonly viewed: ViewedNote;
  readonly cursor: number | null;
}) => {
  const style = span.style ?? {};
  if (span.reference !== undefined) {
    const resolution = viewed.references[span.reference]?.resolution;
    return (
      <Text
        color={referenceColor(resolution)}
        underline={resolution?.state === 'resolved'}
        inverse={span.reference === cursor}
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
      dimColor={style.dim === true}
      underline={style.link === true}
      {...(style.code ? { color: 'green' } : style.heading !== undefined ? { color: 'blue' } : {})}
    >
      {span.text}
    </Text>
  );
};

/** Reads a note, follows references, toggles side panels, hands off to the editor. */
export const NoteView = ({ screen }: { readonly screen: NoteScreen }) => {
  const tui = useTui();
  const { deps, scope, registry, editor, revision, columns, navigate, notify, report } = tui;
  const { suspendTerminal } = useApp();
  const [local, setLocal] = useState(0);
  const [editing, setEditing] = useState(false);
  const height = useBodyHeight();

  const loaded = useLoad(
    () => viewNote(deps, scope, screen.locator),
    [screen.locator, revision, local],
  );
  const viewed = loaded.value;
  const entry = viewed?.entry;
  const located = viewed?.located;

  // Side panels: those that apply to this note; the automatic one has no key.
  const panels = useMemo(
    () =>
      located
        ? registry.panels('note').filter((p) => panelApplies(registry, p, located.note.type))
        : [],
    [registry, located],
  );
  const autoPanel = panels.find((p) => p.key === undefined);
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

  const bodyWidth = Math.max(10, columns - (panel ? PANEL_WIDTH + 1 : 0));
  const lines = useMemo(
    () => (viewed ? renderNote(deps, viewed, bodyWidth) : []),
    [deps, viewed, bodyWidth],
  );
  const maxScroll = Math.max(0, lines.length - height);
  const scroll = clamp(screen.scroll, maxScroll);

  const update = (patch: Partial<NoteScreen>) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'note' ? { ...s, ...patch } : s) });
  };

  const moveReference = (delta: number) => {
    if (!viewed || viewed.references.length === 0) {
      notify('No references in this note');
      return;
    }
    const count = viewed.references.length;
    const next = ((screen.reference ?? (delta > 0 ? -1 : 0)) + delta + count) % count;
    const where = findReferenceSpan(lines, next);
    const offScreen = where && (where.line < scroll || where.line >= scroll + height);
    update({
      reference: next,
      ...(offScreen && { scroll: clamp(where.line - Math.floor(height / 2), maxScroll) }),
    });
  };

  const follow = () => {
    const ref = screen.reference === null ? undefined : viewed?.references[screen.reference];
    if (!ref) {
      notify('Tab to a reference first');
      return;
    }
    if (ref.resolution.state === 'resolved') {
      navigate({ type: 'push', screen: noteScreen({ query: ref.target }) });
    } else {
      notify(whyNotFollowed(ref.resolution, ref.target), 'error');
    }
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
    setLocal((n) => n + 1);
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
    setLocal((n) => n + 1);
    return true;
  };

  useInput((input, key) => {
    if (key.escape && panelFocused) {
      update({ panel: null, panelCursor: 0 });
      return;
    }
    if (isBack(input, key)) {
      navigate({ type: 'pop' });
      return;
    }
    if (input === 'e') return void edit();
    const toggled = panels.find((p) => p.key === input);
    if (toggled) {
      update({ panel: panelId === toggled.id ? null : toggled.id, panelCursor: 0 });
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
    if (isDown(input, key)) update({ scroll: clamp(scroll + 1, maxScroll) });
    else if (isUp(input, key)) update({ scroll: clamp(scroll - 1, maxScroll) });
    else if (key.pageDown || input === ' ') update({ scroll: clamp(scroll + height, maxScroll) });
    else if (key.pageUp) update({ scroll: clamp(scroll - height, maxScroll) });
    else if (input === 'g') update({ scroll: 0 });
    else if (input === 'G') update({ scroll: maxScroll });
    else if (key.tab) moveReference(key.shift ? -1 : 1);
    else if (key.return) follow();
  });

  const idText = entry && isNote(entry) ? entry.id : 'unidentified';
  const typeText = entry && isNote(entry) && entry.type !== undefined ? ` · ${entry.type}` : '';
  const title = viewed
    ? `${viewed.entry.title} · ${viewed.vault.config.name} · ${idText}${typeText}${modifiedMarker(viewed)}`
    : 'loading…';
  const panelKeys = panels
    .filter((p) => p.key !== undefined)
    .map((p) => `${p.key ?? ''} ${p.title.toLowerCase()}`)
    .join('  ');
  const hints = focusedPanel
    ? `panel: j/k move  Enter open  ${actionHints(focusedPanel)}  Esc close  u back`
    : `j/k scroll  Tab ref  Enter follow  ${panelKeys}  e edit  u back`;

  const visible = lines.slice(scroll, scroll + height);
  return (
    <Frame title={title} hints={hints}>
      <Box flexDirection="row" height={height}>
        <Box flexDirection="column" width={bodyWidth} overflow="hidden">
          {loaded.state === 'error' && !viewed ? (
            <Text color="red">error: {loaded.error.message}</Text>
          ) : viewed ? (
            visible.map((line, i) => (
              <Text key={scroll + i} wrap="truncate">
                {line.spans.length === 0
                  ? ' '
                  : line.spans.map((span, j) => (
                      <SpanText key={j} span={span} viewed={viewed} cursor={screen.reference} />
                    ))}
              </Text>
            ))
          ) : (
            <Text dimColor>loading…</Text>
          )}
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
            <Text bold={panelFocused} dimColor={!panelFocused}>
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
    </Frame>
  );
};
