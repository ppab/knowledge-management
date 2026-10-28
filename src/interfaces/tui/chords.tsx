import { Box, Text, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import type { PanelSpec } from '../../application/plugin/plugin.js';
import { isoDate } from '../../application/notes/create-note.js';
import { Dialog } from './components/Dialog.js';
import { useTui, type TuiState } from './context.js';

/*
 * The leader key (decision 0003). `Space` opens a chord; the next key runs one of the screen's
 * chords and a popup lists them meanwhile. Single letters stay with the focused screen; every
 * global action (panel jumps, back, quit) lives here so plugins and screens never collide.
 */

export const LEADER = ' ';
export const LEADER_LABEL = 'Space';

export interface Chord {
  readonly key: string;
  readonly label: string;
  readonly run: () => void;
}

/** Opens a home panel: the calendar as its own screen, anything else as a panel screen. */
export const openHomePanel = (tui: TuiState, panel: PanelSpec): void => {
  if (panel.id === 'core.calendar') {
    tui.navigate({
      type: 'push',
      screen: { kind: 'calendar', cursor: isoDate(tui.deps.clock.now()) },
    });
  } else {
    tui.navigate({ type: 'push', screen: { kind: 'panel', id: panel.id, cursor: 0 } });
  }
};

/** The chords every screen offers: home panel jumps, `b` back on pushed screens, `q` quit. */
export const screenChords = (
  tui: TuiState,
  options: { readonly back: boolean; readonly extra?: readonly Chord[] } = { back: true },
): Chord[] => [
  ...(options.back
    ? [
        {
          key: 'b',
          label: 'back',
          run: () => {
            tui.navigate({ type: 'pop' });
          },
        },
      ]
    : []),
  ...(options.extra ?? []),
  ...tui.registry
    .panels('home')
    .filter((p) => p.chord !== undefined)
    .map((p): Chord => ({
      key: p.chord ?? '',
      label: p.title.toLowerCase(),
      run: () => {
        openHomePanel(tui, p);
      },
    })),
  { key: 'q', label: 'quit', run: tui.quit },
];

export interface Leader {
  /** `Space` was pressed; the screen's own keys are off until the chord completes. */
  readonly pending: boolean;
  /** The which-key popup while pending; `null` otherwise. */
  readonly popup: ReactNode;
}

/**
 * Reads the leader and the key after it. `active` is false while a prompt, picker or other
 * modal flow owns the keyboard, so `Space` types a space there.
 */
export const useLeader = (chords: readonly Chord[], active: boolean): Leader => {
  const { notify } = useTui();
  const [pending, setPending] = useState(false);
  useInput(
    (input, key) => {
      if (!pending) {
        if (input === LEADER && !key.ctrl && !key.meta) setPending(true);
        return;
      }
      setPending(false);
      if (key.escape || input === LEADER) return;
      const chord = chords.find((c) => c.key === input);
      if (chord) chord.run();
      else if (input !== '') notify(`${LEADER_LABEL} ${input} is not bound`, 'error');
    },
    { isActive: active },
  );
  return { pending, popup: pending ? <WhichKey chords={chords} /> : null };
};

const WhichKey = ({ chords }: { readonly chords: readonly Chord[] }) => {
  const { theme } = useTui();
  return (
    <Dialog title={`${LEADER_LABEL} …`} width={40}>
      <Box flexDirection="column">
        {chords.map((c) => (
          <Text key={c.key}>
            <Text {...theme.paint('accent')}>{c.key.padEnd(3)}</Text>
            {c.label}
          </Text>
        ))}
        <Text dimColor>Esc cancel</Text>
      </Box>
    </Dialog>
  );
};
