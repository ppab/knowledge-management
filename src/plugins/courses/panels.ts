import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type {
  PanelAction,
  PanelContext,
  PanelData,
  PanelSpec,
  PluginApi,
  TreeNode,
} from '../../application/plugin/plugin.js';
import { collect } from './model.js';
import { coursesTree } from './tree.js';
import { minutesBetween } from './units.js';

/*
 * The courses tree screen (docs/plans/courses.md, delivery D1): a home panel whose data is the
 * collapsible course tree, with the inline mutation verbs that fit the panel-action contract —
 * `d` marks the focused lesson done, `x` stops the focused running timer. The creating verbs
 * (start/log/set-target) and the leader-menu inputs follow in D2.
 */

const node = (context: PanelContext): TreeNode | undefined =>
  context.selection as TreeNode | undefined;

const loadTree = async (api: PluginApi): Promise<Result<PanelData, AppError>> => {
  const entries = await api.list();
  if (!entries.ok) return entries;
  return ok({ kind: 'tree', roots: coursesTree(collect(entries.value)) });
};

/** Mark the focused lesson done. */
const doneAction: PanelAction = {
  key: 'd',
  label: 'done',
  appliesTo: ['lesson'],
  surface: 'inline',
  async run(api, context) {
    const id = node(context)?.note?.id;
    if (id === undefined) return ok(null);
    return api.setFields(id, { lesson_status: 'done' });
  },
};

/** Stop the focused running timer, recording the elapsed minutes. */
const stopAction: PanelAction = {
  key: 'x',
  label: 'stop',
  appliesTo: ['study'],
  surface: 'inline',
  async run(api, context) {
    const id = node(context)?.note?.id;
    if (id === undefined) return ok(null);
    const entries = await api.list();
    if (!entries.ok) return entries;
    const study = collect(entries.value).studies.find((s) => s.id === id);
    if (study?.open !== true || study.started === undefined) return ok(null);
    return api.setFields(id, {
      study_ended: api.clock.now().toISOString(),
      study_amount: minutesBetween(study.started, api.clock.now().getTime()),
    });
  },
};

export const PANELS: readonly PanelSpec[] = [
  {
    id: 'courses.home',
    title: 'Courses',
    placement: 'home',
    chord: 'C',
    load: loadTree,
    actions: [doneAction, stopAction],
  },
];
