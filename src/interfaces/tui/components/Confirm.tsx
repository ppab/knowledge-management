import { Box, Text, useInput } from 'ink';
import { useTui } from '../context.js';

/** A yes/no prompt that owns the keyboard: `y`/Enter confirms, `n`/Esc cancels (the default). */
export const Confirm = ({
  prompt,
  warnings = [],
  onConfirm,
  onCancel,
}: {
  readonly prompt: string;
  /** Lines shown above the question in the warn role (e.g. links the action would orphan). */
  readonly warnings?: readonly string[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) => {
  const { theme } = useTui();
  useInput((input, key) => {
    if (key.return || input === 'y' || input === 'Y') onConfirm();
    else if (key.escape || input === 'n' || input === 'N') onCancel();
  });
  return (
    <Box flexDirection="column">
      {warnings.map((line, i) => (
        <Text key={i} {...theme.paint('warn')} wrap="truncate">
          {line}
        </Text>
      ))}
      <Text>
        <Text bold {...theme.paint('accent')}>
          {prompt}
        </Text>{' '}
        <Text dimColor>[y/N]</Text>
        <Text inverse> </Text>
      </Text>
    </Box>
  );
};
