import { Box, Text, useInput, type Key } from 'ink';
import { useTui } from '../context.js';
import { isBack, isDown, isUp } from '../keys.js';
import { clamp } from '../model.js';
import type { Role } from '../theme.js';

/** One line of read-only text with an optional colour role. */
export interface TextLine {
  readonly text: string;
  readonly role?: Role;
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
  const half = Math.max(1, Math.floor(height / 2));
  if (key.pageDown || (key.ctrl && input === 'f')) return clamp(scroll + height, max);
  if (key.pageUp || (key.ctrl && input === 'b')) return clamp(scroll - height, max);
  if (key.ctrl && input === 'd') return clamp(scroll + half, max);
  if (key.ctrl && input === 'u') return clamp(scroll - half, max);
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
  options: { readonly active?: boolean; readonly onOther?: (input: string, key: Key) => void } = {},
): void => {
  useInput(
    (input, key) => {
      if (isBack(input, key)) {
        onBack();
        return;
      }
      const next = scrolledBy(input, key, scroll, total, height);
      if (next !== undefined) onScroll(next);
      else options.onOther?.(input, key);
    },
    { isActive: options.active ?? true },
  );
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
}) => {
  const { theme } = useTui();
  return (
    <Box flexDirection="column">
      {lines.length === 0 ? (
        <Text dimColor>{empty}</Text>
      ) : (
        lines.slice(scroll, scroll + height).map((line, i) => (
          <Text
            key={scroll + i}
            wrap="truncate"
            {...(line.role !== undefined ? theme.paint(line.role) : {})}
            dimColor={line.dim === true}
          >
            {line.text === '' ? ' ' : line.text}
          </Text>
        ))
      )}
    </Box>
  );
};
