import { Text, useInput } from 'ink';
import { useState } from 'react';

/** A one-line text input; `Enter` submits, `Esc` cancels. Owns the keyboard while shown. */
export const Prompt = ({
  label,
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}) => {
  const [value, setValue] = useState('');
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(value);
    else if (key.backspace || key.delete) setValue((v) => v.slice(0, -1));
    else if (!key.ctrl && !key.meta && input !== '') setValue((v) => v + input);
  });
  return (
    <Text>
      <Text bold>{label}</Text> {value}
      <Text inverse> </Text>
    </Text>
  );
};
