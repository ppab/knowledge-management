import { Text, useInput } from 'ink';
import { useState } from 'react';
import { useTui } from '../context.js';

/** A one-line text input; `Enter` submits, `Esc` cancels. Owns the keyboard while shown. */
export const Prompt = ({
  label,
  initial,
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  /** Pre-filled, editable text (e.g. a note's current tags). Empty when absent. */
  readonly initial?: string;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}) => {
  const { theme } = useTui();
  const [value, setValue] = useState(initial ?? '');
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(value);
    else if (key.backspace || key.delete) setValue((v) => v.slice(0, -1));
    else if (!key.ctrl && !key.meta && input !== '') setValue((v) => v + input);
  });
  return (
    <Text>
      <Text bold {...theme.paint('accent')}>
        {label}
      </Text>{' '}
      {value}
      <Text inverse> </Text>
    </Text>
  );
};
