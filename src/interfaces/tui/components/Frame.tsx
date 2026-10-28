import { Box, Spacer, Text } from 'ink';
import type { ReactNode } from 'react';
import { useTui } from '../context.js';

/** One key hint: the key (empty for a bare label) and what it does. */
export type Hint = readonly [key: string, label: string];

/** Hints read as `key label` pairs two spaces apart, the key in the accent colour. */
export const Hints = ({
  hints,
  mode,
}: {
  readonly hints: readonly Hint[];
  readonly mode?: string;
}) => {
  const { theme } = useTui();
  return (
    <Text wrap="truncate">
      {mode !== undefined && <Text bold>{mode}: </Text>}
      {hints.map(([key, label], i) => (
        <Text key={i}>
          {i > 0 ? '  ' : ''}
          {key !== '' && <Text {...theme.paint('accent')}>{key}</Text>}
          <Text dimColor>
            {key !== '' ? ' ' : ''}
            {label}
          </Text>
        </Text>
      ))}
    </Text>
  );
};

/**
 * Header line (title left, `meta` right), body, and a footer that shows the last status
 * message or the key hints.
 */
export const Frame = ({
  title,
  meta,
  hints,
  mode,
  overlay,
  children,
}: {
  readonly title: string;
  /** Right-aligned header text, or a node such as the calendar's view tabs. */
  readonly meta?: ReactNode;
  readonly hints: readonly Hint[];
  /** A prefix naming the mode the hints belong to (`select`, `panel`). */
  readonly mode?: string;
  /** Drawn above the body: the leader's which-key popup. */
  readonly overlay?: ReactNode;
  readonly children: ReactNode;
}) => {
  const { rows, columns, status, theme } = useTui();
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box width={columns}>
        <Text bold {...theme.paint('accent')} wrap="truncate">
          {title}
        </Text>
        {meta !== undefined && (
          <>
            <Spacer />
            {typeof meta === 'string' ? (
              <Text dimColor wrap="truncate">
                {meta}
              </Text>
            ) : (
              meta
            )}
          </>
        )}
      </Box>
      <Box flexDirection="column" height={Math.max(1, rows - 2)} overflow="hidden">
        {overlay}
        {children}
      </Box>
      {status ? (
        <Text {...theme.paint(status.level === 'error' ? 'error' : 'ok')} wrap="truncate">
          {status.text}
        </Text>
      ) : (
        <Hints hints={hints} {...(mode !== undefined && { mode })} />
      )}
    </Box>
  );
};

/** Body height available to a screen inside a `Frame`. */
export const useBodyHeight = (): number => Math.max(1, useTui().rows - 2);
