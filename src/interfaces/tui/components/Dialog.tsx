import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useTui } from '../context.js';

/** Rows a dialog spends on its own border, to subtract from the height given to its content. */
export const DIALOG_CHROME = 2;

/** A rounded, bordered box for a prompt or a picker, so a modal flow reads as one. */
export const Dialog = ({
  title,
  width,
  children,
}: {
  readonly title?: string;
  /** Preferred width in cells; the terminal's width caps it. Absent: the full width. */
  readonly width?: number;
  readonly children: ReactNode;
}) => {
  const { columns, theme } = useTui();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      {...(theme.colors && { borderColor: 'cyan' })}
      paddingX={1}
      width={Math.min(columns, width ?? columns)}
      flexShrink={0}
    >
      {title !== undefined && (
        <Text bold {...theme.paint('accent')} wrap="truncate">
          {title}
        </Text>
      )}
      {children}
    </Box>
  );
};
