import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useTui } from '../context.js';

/** Header line, body, and a footer that shows the last status message or the key hints. */
export const Frame = ({
  title,
  hints,
  children,
}: {
  readonly title: string;
  readonly hints: string;
  readonly children: ReactNode;
}) => {
  const { rows, columns, status } = useTui();
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Text bold wrap="truncate">
        {title}
      </Text>
      <Box flexDirection="column" height={Math.max(1, rows - 2)} overflow="hidden">
        {children}
      </Box>
      {status ? (
        <Text color={status.level === 'error' ? 'red' : 'green'} wrap="truncate">
          {status.text}
        </Text>
      ) : (
        <Text dimColor wrap="truncate">
          {hints}
        </Text>
      )}
    </Box>
  );
};

/** Body height available to a screen inside a `Frame`. */
export const useBodyHeight = (): number => Math.max(1, useTui().rows - 2);
