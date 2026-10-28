import { Text, useInput } from 'ink';
import { useState } from 'react';
import type { Heading } from '../../../domain/note/note.js';
import { REFERENCES_HEADING, type InsertionLocation } from '../../../domain/text/insertion.js';
import { isDown, isUp } from '../keys.js';
import { useTui } from '../context.js';
import { clamp } from '../model.js';
import { Dialog, DIALOG_CHROME } from './Dialog.js';
import { Rows } from './Rows.js';

export interface LocationChoice {
  readonly label: string;
  readonly at: InsertionLocation;
}

/** End of note, under each heading, or the references section (the CLI's `--at` choices). */
export const locationChoices = (headings: readonly Heading[]): LocationChoice[] => [
  { label: 'End of note', at: { kind: 'end' } },
  ...headings.map((h): LocationChoice => ({
    label: `Under ${'#'.repeat(h.depth)} ${h.text}`,
    at: { kind: 'heading', text: h.text },
  })),
  {
    label: `${REFERENCES_HEADING} section (created when absent)`,
    at: { kind: 'references' },
  },
];

/** Where an inserted reference goes: `j/k` move, `Enter` chooses, `Esc` cancels. */
export const LocationPrompt = ({
  target,
  headings,
  height,
  onPick,
  onCancel,
}: {
  readonly target: string;
  readonly headings: readonly Heading[];
  readonly height: number;
  readonly onPick: (at: InsertionLocation) => void;
  readonly onCancel: () => void;
}) => {
  const { theme } = useTui();
  const choices = locationChoices(headings);
  const [cursor, setCursor] = useState(0);
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) {
      const choice = choices[cursor];
      if (choice) onPick(choice.at);
    } else if (isDown(input, key)) setCursor(clamp(cursor + 1, choices.length - 1));
    else if (isUp(input, key)) setCursor(clamp(cursor - 1, choices.length - 1));
  });
  return (
    <Dialog>
      <Text>
        <Text bold {...theme.paint('accent')}>
          insert reference to
        </Text>{' '}
        {target} <Text dimColor>where?</Text>
      </Text>
      <Rows
        rows={choices.map((c) => [c.label])}
        cursor={cursor}
        height={height - 1 - DIALOG_CHROME}
        empty="No locations."
      />
    </Dialog>
  );
};
