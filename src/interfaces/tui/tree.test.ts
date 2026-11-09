import { describe, expect, it } from 'vitest';
import { ok } from '../../domain/result.js';
import type { PanelAction, TreeNode } from '../../application/plugin/plugin.js';
import { actionApplies, flattenTree, isExpanded, nodeActions } from './tree.js';

const TREE: TreeNode[] = [
  {
    id: 'c',
    label: 'Course',
    type: 'course',
    expanded: true,
    children: [
      { id: 'ch', label: 'Chapters', children: [{ id: 'l1', label: 'L1', type: 'lesson' }] },
      {
        id: 'se',
        label: 'Sessions',
        expanded: false,
        children: [{ id: 's1', label: 'S1', type: 'study' }],
      },
    ],
  },
];

const ids = (toggled: Set<string>): string[] => flattenTree(TREE, toggled).map((f) => f.node.id);

const action = (key: string, type: string, surface: 'inline' | 'menu'): PanelAction => ({
  key,
  label: key,
  appliesTo: [type],
  surface,
  run: () => Promise.resolve(ok(null)),
});

describe('flattenTree', () => {
  it('hides a collapsed node’s subtree and respects node defaults', () => {
    // Sessions defaults collapsed, so s1 is hidden until toggled.
    expect(ids(new Set())).toEqual(['c', 'ch', 'l1', 'se']);
    expect(ids(new Set(['se']))).toEqual(['c', 'ch', 'l1', 'se', 's1']);
    expect(ids(new Set(['c']))).toEqual(['c']);
  });

  it('reads the effective expansion of a node', () => {
    const course = TREE[0];
    const sessions = course?.children?.[1];
    if (!course || !sessions) throw new Error('bad fixture');
    expect(isExpanded(course, new Set())).toBe(true);
    expect(isExpanded(sessions, new Set())).toBe(false);
    expect(isExpanded(sessions, new Set(['se']))).toBe(true);
    expect(isExpanded(course, new Set(['c']))).toBe(false);
  });
});

describe('node verb scoping', () => {
  const actions = [action('d', 'lesson', 'inline'), action('l', 'course', 'menu')];
  const lesson: TreeNode = { id: 'x', label: 'x', type: 'lesson' };
  const course: TreeNode = { id: 'y', label: 'y', type: 'course' };
  const group: TreeNode = { id: 'g', label: 'Chapters' };

  it('offers a verb only on the types it applies to', () => {
    const lessonVerb = actions[0]!;
    expect(actionApplies(lessonVerb, lesson)).toBe(true);
    expect(actionApplies(lessonVerb, course)).toBe(false);
    expect(actionApplies(lessonVerb, group)).toBe(false);
  });

  it('filters by surface and type', () => {
    expect(nodeActions(actions, lesson, 'inline').map((a) => a.key)).toEqual(['d']);
    expect(nodeActions(actions, lesson, 'menu')).toEqual([]);
    expect(nodeActions(actions, course, 'menu').map((a) => a.key)).toEqual(['l']);
    expect(nodeActions(actions, group, 'inline')).toEqual([]);
  });
});
