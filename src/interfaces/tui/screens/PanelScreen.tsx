import { Text, useInput } from 'ink';
import { useState } from 'react';
import type { PanelAction } from '../../../application/plugin/plugin.js';
import { screenChords, useLeader, type Chord } from '../chords.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import type { Hint } from '../components/Frame.js';
import { actionHints, PanelView } from '../components/PanelView.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, locatorOf, noteScreen, type Screen } from '../model.js';
import { apiForPanel, noteAt, outcomeText, rowAt, rowCount } from '../panels.js';
import { flattenTree, nodeActions } from '../tree.js';

type PanelScreenState = Extract<Screen, { kind: 'panel' }>;

/**
 * A home panel as a full screen. A list/table shows rows with a cursor; a `tree` shows a
 * collapsible outline — `h`/`l` fold a node, `Enter` opens it, its inline verbs run on their key,
 * and the leader menu offers the focused node's menu verbs, scoped to its type.
 */
export const PanelScreen = ({ screen }: { readonly screen: PanelScreenState }) => {
  const tui = useTui();
  const { registry, revision, navigate, notify, report } = tui;
  const [local, setLocal] = useState(0);
  const height = useBodyHeight();
  const spec = registry.panels('home').find((p) => p.id === screen.id);

  const loaded = useLoad(
    () =>
      spec
        ? spec.load(apiForPanel(tui, spec), {})
        : Promise.resolve({
            ok: false as const,
            error: { code: 'NOT_FOUND' as const, message: `No panel ${screen.id}` },
          }),
    [screen.id, revision, local],
  );
  const data = loaded.value;
  const tree = data?.kind === 'tree' ? data : undefined;
  const toggled = new Set(screen.toggled ?? []);
  const flat = tree ? flattenTree(tree.roots, toggled) : [];
  const count = tree ? flat.length : rowCount(data);
  const cursor = clamp(screen.cursor, count - 1);
  const focused = tree ? flat[cursor] : undefined;
  const node = focused?.node;

  const runAction = (action: PanelAction, selection: unknown) => {
    if (!spec) return;
    void action.run(apiForPanel(tui, spec), { selection }).then((outcome) => {
      if (outcome.ok) notify(outcomeText(outcome.value));
      else report(outcome.error);
      setLocal((n) => n + 1);
    });
  };

  const menuChords: Chord[] =
    node && spec
      ? nodeActions(spec.actions ?? [], node, 'menu').map((a) => ({
          key: a.key,
          label: a.label,
          run: () => {
            runAction(a, node);
          },
        }))
      : [];
  const leader = useLeader(screenChords(tui, { back: true, extra: menuChords }), true);

  const update = (c: number) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'panel' ? { ...s, cursor: c } : s) });
  };
  const toggle = (id: string) => {
    const next = new Set(toggled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    navigate({
      type: 'update',
      update: (s) => (s.kind === 'panel' ? { ...s, toggled: [...next] } : s),
    });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) {
        navigate({ type: 'pop' });
        return;
      }
      if (isDown(input, key)) {
        update(clamp(cursor + 1, count - 1));
        return;
      }
      if (isUp(input, key)) {
        update(clamp(cursor - 1, count - 1));
        return;
      }

      if (tree) {
        if (focused && node && focused.hasChildren && (input === 'l' || key.rightArrow)) {
          if (!focused.expanded) toggle(node.id);
          return;
        }
        if (focused && node && focused.hasChildren && (input === 'h' || key.leftArrow)) {
          if (focused.expanded) toggle(node.id);
          return;
        }
        if (key.return) {
          if (node?.note) navigate({ type: 'push', screen: noteScreen(locatorOf(node.note)) });
          else notify('Nothing to open on this node');
          return;
        }
        if (node) {
          const inline = nodeActions(spec?.actions ?? [], node, 'inline').find(
            (a) => a.key === input,
          );
          if (inline) runAction(inline, node);
        }
        return;
      }

      if (key.return) {
        const ref = noteAt(data, cursor);
        if (ref) navigate({ type: 'push', screen: noteScreen(locatorOf(ref)) });
        else notify('Nothing to open on this row');
        return;
      }
      const action = spec?.actions?.find((a) => a.key === input);
      if (action && spec) runAction(action, rowAt(data, cursor));
    },
    { isActive: !leader.pending },
  );

  if (!spec) return <Text {...tui.theme.paint('error')}>No panel {screen.id}</Text>;
  const inlineHints: Hint[] =
    tree && node
      ? nodeActions(spec.actions ?? [], node, 'inline').map((a) => [a.key, a.label])
      : [];
  const hints: Hint[] = tree
    ? [
        ['j/k', 'move'],
        ['h/l', 'fold'],
        ['Enter', 'open'],
        ...inlineHints,
        ['Space', 'menu'],
        ['Esc', 'back'],
      ]
    : [
        ['j/k', 'move'],
        ['Enter', 'open'],
        ...actionHints(spec),
        ['Space', 'menu'],
        ['Esc', 'back'],
      ];
  return (
    <Frame title={spec.title} hints={hints} overlay={leader.popup}>
      <PanelView spec={spec} loaded={loaded} cursor={cursor} height={height} flat={flat} />
    </Frame>
  );
};
