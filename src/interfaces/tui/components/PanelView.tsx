import { Box, Text } from 'ink';
import type { PanelData, PanelSpec } from '../../../application/plugin/plugin.js';
import { useTui, type Loaded } from '../context.js';
import type { Hint } from './Frame.js';
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
  const { theme } = useTui();
  if (loaded.state === 'error' && loaded.value === undefined) {
    return <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>;
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
          roles={[null, 'muted']}
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
export const actionHints = (spec: PanelSpec): Hint[] =>
  (spec.actions ?? []).map((a): Hint => [a.key, a.label]);
