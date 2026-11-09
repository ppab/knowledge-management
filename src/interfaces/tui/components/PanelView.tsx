import { Box, Text } from 'ink';
import type { PanelData, PanelSpec } from '../../../application/plugin/plugin.js';
import { useTui, type Loaded } from '../context.js';
import type { FlatNode } from '../tree.js';
import type { Hint } from './Frame.js';
import { Rows } from './Rows.js';
import { TreeView } from './TreeView.js';

/** Renders whatever a panel's `load` returned (docs/plugins.md §4): a list, table, tree or text. */
export const PanelView = ({
  spec,
  loaded,
  cursor,
  height,
  flat,
}: {
  readonly spec: PanelSpec;
  readonly loaded: Loaded<PanelData>;
  readonly cursor: number;
  readonly height: number;
  /** The flattened visible nodes, for a `tree` panel (the screen holds the collapse state). */
  readonly flat?: readonly FlatNode[];
}) => {
  const { theme } = useTui();
  if (loaded.state === 'error' && loaded.value === undefined) {
    return <Text {...theme.paint('error')}>error: {loaded.error.message}</Text>;
  }
  const data = loaded.value;
  if (!data) return <Text dimColor>loading…</Text>;
  switch (data.kind) {
    case 'tree':
      return (
        <TreeView
          flat={flat ?? []}
          cursor={cursor}
          height={height}
          empty={`No ${spec.title.toLowerCase()}.`}
        />
      );
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
