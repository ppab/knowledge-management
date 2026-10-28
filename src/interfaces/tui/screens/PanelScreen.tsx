import { Text, useInput } from 'ink';
import { useState } from 'react';
import { screenChords, useLeader } from '../chords.js';
import { Frame, useBodyHeight } from '../components/Frame.js';
import { actionHints, PanelView } from '../components/PanelView.js';
import { useLoad, useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp, locatorOf, noteScreen, type Screen } from '../model.js';
import { apiForPanel, noteAt, outcomeText, rowAt, rowCount } from '../panels.js';

type PanelScreenState = Extract<Screen, { kind: 'panel' }>;

/** A home panel as a full screen: rows with a cursor, `Enter` opens, action keys act. */
export const PanelScreen = ({ screen }: { readonly screen: PanelScreenState }) => {
  const tui = useTui();
  const { registry, revision, navigate, notify, report } = tui;
  const [local, setLocal] = useState(0);
  const height = useBodyHeight();
  const leader = useLeader(screenChords(tui), true);
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
  const cursor = clamp(screen.cursor, rowCount(data) - 1);

  const update = (c: number) => {
    navigate({ type: 'update', update: (s) => (s.kind === 'panel' ? { ...s, cursor: c } : s) });
  };

  useInput(
    (input, key) => {
      if (isBack(input, key)) {
        navigate({ type: 'pop' });
        return;
      }
      if (isDown(input, key)) {
        update(clamp(cursor + 1, rowCount(data) - 1));
        return;
      }
      if (isUp(input, key)) {
        update(clamp(cursor - 1, rowCount(data) - 1));
        return;
      }
      if (key.return) {
        const ref = noteAt(data, cursor);
        if (ref) navigate({ type: 'push', screen: noteScreen(locatorOf(ref)) });
        else notify('Nothing to open on this row');
        return;
      }
      const action = spec?.actions?.find((a) => a.key === input);
      if (!action || !spec) return;
      void action
        .run(apiForPanel(tui, spec), { selection: rowAt(data, cursor) })
        .then((outcome) => {
          if (outcome.ok) notify(outcomeText(outcome.value));
          else report(outcome.error);
          setLocal((n) => n + 1);
        });
    },
    { isActive: !leader.pending },
  );

  if (!spec) return <Text {...tui.theme.paint('error')}>No panel {screen.id}</Text>;
  return (
    <Frame
      title={spec.title}
      hints={[
        ['j/k', 'move'],
        ['Enter', 'open'],
        ...actionHints(spec),
        ['Space', 'menu'],
        ['Esc', 'back'],
      ]}
      overlay={leader.popup}
    >
      <PanelView spec={spec} loaded={loaded} cursor={cursor} height={height} />
    </Frame>
  );
};
