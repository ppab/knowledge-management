import { Box, Text } from 'ink';
import { useTui } from '../context.js';
import { windowStart } from '../model.js';
import type { Role } from '../theme.js';

/** Column widths like the CLI's `table`, so rows line up; the last column takes the rest. */
const widths = (rows: readonly (readonly string[])[]): number[] => {
  const out: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      out[i] = Math.max(out[i] ?? 0, cell.length);
    });
  }
  return out;
};

const padded = (row: readonly string[], w: readonly number[]): string[] =>
  row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(w[i] ?? 0)));

/** The cursor row's marker; other rows are indented to match so columns stay aligned. */
export const CURSOR_MARK = '▸ ';
const NO_MARK = '  ';

/**
 * A cursor-driven table: `height` rows of `rows` around `cursor`, header kept in place. The
 * cursor row is marked and painted whole; other rows paint each column by its `role`.
 */
export const Rows = ({
  header,
  rows,
  roles = [],
  cursor,
  height,
  empty,
}: {
  readonly header?: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** A role per column (`null` for plain text); columns past the end are plain. */
  readonly roles?: readonly (Role | null)[];
  readonly cursor: number;
  readonly height: number;
  readonly empty: string;
}) => {
  const { theme } = useTui();
  const w = widths(header ? [header, ...rows] : rows);
  const bodyHeight = Math.max(1, height - (header ? 1 : 0));
  const start = windowStart(cursor, bodyHeight);
  const visible = rows.slice(start, start + bodyHeight);
  return (
    <Box flexDirection="column">
      {header && (
        <Text dimColor wrap="truncate">
          {NO_MARK}
          {padded(header, w).join('  ')}
        </Text>
      )}
      {rows.length === 0 ? (
        <Text dimColor>{empty}</Text>
      ) : (
        visible.map((row, i) => {
          const selected = start + i === cursor;
          const cells = padded(row, w);
          return selected ? (
            <Text key={start + i} bold {...theme.paint('accent')} wrap="truncate">
              {CURSOR_MARK}
              {cells.join('  ')}
            </Text>
          ) : (
            <Text key={start + i} wrap="truncate">
              {NO_MARK}
              {cells.map((cell, c) => {
                const role = roles[c] ?? null;
                return (
                  <Text key={c} {...(role === null ? {} : theme.paint(role))}>
                    {c > 0 ? '  ' : ''}
                    {cell}
                  </Text>
                );
              })}
            </Text>
          );
        })
      )}
    </Box>
  );
};
