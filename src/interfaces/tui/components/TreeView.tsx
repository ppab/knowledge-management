import { Box, Text } from 'ink';
import { useTui } from '../context.js';
import { windowStart } from '../model.js';
import type { FlatNode } from '../tree.js';
import { CURSOR_MARK } from './Rows.js';

/*
 * A cursor-driven tree: a window of `height` visible nodes around `cursor`, each indented by its
 * depth with an expand marker, its detail dimmed, and its inline verbs shown as `[label]` spans.
 * The flattening and collapse live in `tree.ts` / the screen; this only draws what it is given.
 */

const INDENT = '  ';
const NO_MARK = '  ';

const expandMark = (node: FlatNode): string =>
  node.hasChildren ? (node.expanded ? '▾ ' : '▸ ') : '  ';

export const TreeView = ({
  flat,
  cursor,
  height,
  empty,
}: {
  readonly flat: readonly FlatNode[];
  readonly cursor: number;
  readonly height: number;
  readonly empty: string;
}) => {
  const { theme } = useTui();
  if (flat.length === 0) return <Text dimColor>{empty}</Text>;
  const body = Math.max(1, height);
  const start = windowStart(cursor, body);
  const visible = flat.slice(start, start + body);
  return (
    <Box flexDirection="column">
      {visible.map((item, i) => {
        const index = start + i;
        const selected = index === cursor;
        const label = `${INDENT.repeat(item.depth)}${expandMark(item)}${item.node.label}`;
        const detail = item.node.detail === undefined ? '' : `  ${item.node.detail}`;
        const actions = (item.node.actions ?? []).map((a) => ` [${a.label}]`).join('');
        if (selected) {
          return (
            <Text key={index} bold {...theme.paint('accent')} wrap="truncate">
              {CURSOR_MARK}
              {label}
              {detail}
              {actions}
            </Text>
          );
        }
        return (
          <Text key={index} wrap="truncate">
            {NO_MARK}
            {label}
            <Text {...theme.paint('muted')}>{detail}</Text>
            <Text {...theme.paint('accent')}>{actions}</Text>
          </Text>
        );
      })}
    </Box>
  );
};
