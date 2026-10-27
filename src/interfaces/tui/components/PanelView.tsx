import { Box, Text } from 'ink';
import type { PanelData, PanelSpec } from '../../../application/plugin/plugin.js';
import type { Loaded } from '../context.js';
import { Rows } from './Rows.js';

/** Renders whatever a panel's `load` returned (docs/plugins.md §4): a list, a table or text. */
export const PanelView = ({
  spec,
  loaded,
  cursor,
  height,
}: {
  readonly spec: PanelSpec;
  readonly loaded: Loaded<PanelData>;
  readonly cursor: number;
  readonly height: number;
}) => {
  if (loaded.state === 'error' && loaded.value === undefined) {
    return <Text color="red">error: {loaded.error.message}</Text>;
  }
  const data = loaded.value;
  if (!data) return <Text dimColor>loading…</Text>;
  switch (data.kind) {
    case 'text':
      return (
        <Box flexDirection="column">
          {data.lines.slice(0, height).map((line, i) => (
            <Text key={i} wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      );
    case 'list':
      return (
        <Rows
          rows={data.items.map((item) =>
            item.detail === undefined ? [item.title] : [item.title, item.detail],
          )}
          cursor={cursor}
          height={height}
          empty={`No ${spec.title.toLowerCase()}.`}
        />
      );
    case 'table':
      return (
        <Rows
          header={data.header}
          rows={data.rows.map((row) => row.cells)}
          cursor={cursor}
          height={height}
          empty={`No ${spec.title.toLowerCase()}.`}
        />
      );
  }
};

/** `d Mark done  …` for the hints line. */
export const actionHints = (spec: PanelSpec): string =>
  (spec.actions ?? []).map((a) => `${a.key} ${a.label}`).join('  ');
