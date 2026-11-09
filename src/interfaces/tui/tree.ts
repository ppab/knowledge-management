import type { PanelAction, TreeNode } from '../../application/plugin/plugin.js';

/*
 * The pure view model behind a `tree` panel: the visible nodes in order, given which ones the
 * viewer has toggled away from their default expansion. A node is expanded by `node.expanded`
 * (default true), flipped when its id is in `toggled`; a collapsed node hides its subtree. Kept
 * free of Ink so the flattening and the verb scoping can be tested directly.
 */

export interface FlatNode {
  readonly node: TreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

/** Whether a node with children is currently shown open. */
export const isExpanded = (node: TreeNode, toggled: ReadonlySet<string>): boolean =>
  (node.expanded ?? true) !== toggled.has(node.id);

/** The visible nodes, parents before their shown children, depth-first. */
export const flattenTree = (
  roots: readonly TreeNode[],
  toggled: ReadonlySet<string>,
): FlatNode[] => {
  const out: FlatNode[] = [];
  const walk = (nodes: readonly TreeNode[], depth: number): void => {
    for (const node of nodes) {
      const children = node.children ?? [];
      const hasChildren = children.length > 0;
      const expanded = hasChildren && isExpanded(node, toggled);
      out.push({ node, depth, hasChildren, expanded });
      if (expanded) walk(children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
};

/** A verb is offered on a node when it is untyped-for-all or lists the node's type. */
export const actionApplies = (action: PanelAction, node: TreeNode): boolean =>
  action.appliesTo === undefined ||
  (node.type !== undefined && action.appliesTo.includes(node.type));

/** The focused node's verbs for a surface, in declaration order. */
export const nodeActions = (
  actions: readonly PanelAction[],
  node: TreeNode,
  surface: 'inline' | 'menu',
): PanelAction[] =>
  actions.filter((a) => (a.surface ?? 'menu') === surface && actionApplies(a, node));
