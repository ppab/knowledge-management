import { Box, Text } from 'ink';
import { windowStart } from '../model.js';

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

const joinRow = (row: readonly string[], w: readonly number[]): string =>
  row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(w[i] ?? 0))).join('  ');

/** A cursor-driven table: `height` rows of `rows` around `cursor`, header kept in place. */
export const Rows = ({
  header,
  rows,
  cursor,
  height,
  empty,
}: {
  readonly header?: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly cursor: number;
  readonly height: number;
  readonly empty: string;
}) => {
  const w = widths(header ? [header, ...rows] : rows);
  const bodyHeight = Math.max(1, height - (header ? 1 : 0));
  const start = windowStart(cursor, bodyHeight);
  const visible = rows.slice(start, start + bodyHeight);
  return (
    <Box flexDirection="column">
      {header && (
        <Text dimColor wrap="truncate">
          {joinRow(header, w)}
        </Text>
      )}
      {rows.length === 0 ? (
        <Text dimColor>{empty}</Text>
      ) : (
        visible.map((row, i) => (
          <Text key={start + i} inverse={start + i === cursor} wrap="truncate">
            {joinRow(row, w)}
          </Text>
        ))
      )}
    </Box>
  );
};
