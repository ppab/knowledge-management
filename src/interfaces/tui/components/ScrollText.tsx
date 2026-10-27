import { Box, Text, useInput, type Key } from 'ink';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp } from '../model.js';

/** One line of read-only text with an optional colour. */
export interface TextLine {
  readonly text: string;
  readonly color?: string;
  readonly dim?: boolean;
}

/** The scroll position after a vim-style key on `total` lines in a window of `height`. */
export const scrolledBy = (
  input: string,
  key: Key,
  scroll: number,
  total: number,
  height: number,
): number | undefined => {
  const max = Math.max(0, total - height);
  if (isDown(input, key)) return clamp(scroll + 1, max);
  if (isUp(input, key)) return clamp(scroll - 1, max);
  if (key.pageDown || input === ' ') return clamp(scroll + height, max);
  if (key.pageUp) return clamp(scroll - height, max);
  if (input === 'g') return 0;
  if (input === 'G') return max;
  return undefined;
};

/** Scrolls `lines` with `j/k`, page keys, `g/G`; `onBack` on the usual back keys. */
export const useScrollKeys = (
  scroll: number,
  total: number,
  height: number,
  onScroll: (next: number) => void,
  onBack: () => void,
  onOther?: (input: string, key: Key) => void,
): void => {
  useInput((input, key) => {
    if (isBack(input, key)) {
      onBack();
      return;
    }
    const next = scrolledBy(input, key, scroll, total, height);
    if (next !== undefined) onScroll(next);
    else onOther?.(input, key);
  });
};

export const ScrollText = ({
  lines,
  scroll,
  height,
  empty,
}: {
  readonly lines: readonly TextLine[];
  readonly scroll: number;
  readonly height: number;
  readonly empty: string;
}) => (
  <Box flexDirection="column">
    {lines.length === 0 ? (
      <Text dimColor>{empty}</Text>
    ) : (
      lines.slice(scroll, scroll + height).map((line, i) => (
        <Text
          key={scroll + i}
          wrap="truncate"
          {...(line.color !== undefined && { color: line.color })}
          dimColor={line.dim === true}
        >
          {line.text === '' ? ' ' : line.text}
        </Text>
      ))
    )}
  </Box>
);
