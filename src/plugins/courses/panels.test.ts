import { describe, expect, it } from 'vitest';
import { createPluginApi } from '../../application/plugin/api.js';
import type {
  PanelActionResult,
  PanelData,
  PanelSpec,
  PluginApi,
  TreeNode,
} from '../../application/plugin/plugin.js';
import { buildRegistry, enabledPlugin } from '../../application/plugin/registry.js';
import { unwrap } from '../../domain/result.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { collect } from './model.js';
import { coursesPlugin } from './plugin.js';
import { coursesTree } from './tree.js';

const note = (
  id: string,
  type: string,
  fields: Record<string, string>,
  dates?: readonly string[],
): string =>
  [
    '---',
    `id: "${id}"`,
    `title: "${id === 'CS' ? 'CS50' : id}"`,
    `type: ${type}`,
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    ...(dates ? [`dates: [${dates.map((d) => `"${d}"`).join(', ')}]`] : []),
    '---',
    '',
  ].join('\n');

const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime();
const openStudy = (id: string, minutesAgo: number): string =>
  [
    '---',
    `id: "${id}"`,
    `title: "${id}"`,
    'type: study',
    'study_course: "[[CS]]"',
    `study_started: "${new Date(NOW - minutesAgo * 60000).toISOString()}"`,
    'dates: ["2026-10-27"]',
    '---',
    '',
  ].join('\n');

const setup = (extra: Record<string, string> = {}): { f: Fixture; api: PluginApi } => {
  const f = fixture({ plugins: { courses: {} } });
  f.fs.files.set('course.md', note('CS', 'course', { course_status: 'active' }));
  f.fs.files.set(
    'ch0.md',
    note('CH0', 'chapter', { chapter_course: '"[[CS]]"', chapter_order: '0' }),
  );
  f.fs.files.set(
    'l0.md',
    note('L0', 'lesson', { lesson_chapter: '"[[CH0]]"', lesson_status: 'done', lesson_order: '0' }),
  );
  f.fs.files.set(
    'l1.md',
    note('L1', 'lesson', {
      lesson_chapter: '"[[CH0]]"',
      lesson_status: 'in-progress',
      lesson_order: '1',
    }),
  );
  f.fs.files.set(
    'st0.md',
    note('ST0', 'study', { study_course: '"[[CS]]"', study_amount: '90' }, ['2026-11-08']),
  );
  for (const [path, source] of Object.entries(extra)) f.fs.files.set(path, source);
  const registry = unwrap(buildRegistry([coursesPlugin], f.scope));
  const enabled = enabledPlugin(registry, 'courses');
  if (!enabled) throw new Error('courses not enabled');
  return { f, api: createPluginApi(f.deps, registry, enabled) };
};

const panel = (): PanelSpec => {
  const found = coursesPlugin.panels?.find((p) => p.id === 'courses.home');
  if (!found) throw new Error('no courses.home panel');
  return found;
};

const find = (roots: readonly TreeNode[], id: string): TreeNode | undefined => {
  for (const node of roots) {
    if (node.id === id) return node;
    const inner = node.children ? find(node.children, id) : undefined;
    if (inner) return inner;
  }
  return undefined;
};

describe('courses tree', () => {
  it('builds a two-branch course node with derived expansion and glyphs', async () => {
    const { api } = setup();
    const roots = coursesTree(collect(unwrap(await api.list())));
    const course = roots[0];
    expect(course).toMatchObject({ id: 'CS', type: 'course', expanded: true });
    expect(course?.detail).toContain('1/2 lessons');
    expect(course?.children?.map((c) => c.label)).toEqual(['Chapters', 'Sessions (1)']);

    const chapters = course?.children?.[0];
    // The chapter holding the in-progress lesson is expanded.
    expect(chapters?.children?.[0]).toMatchObject({ id: 'CH0', expanded: true });

    const l0 = find(roots, 'L0');
    const l1 = find(roots, 'L1');
    expect(l0?.label).toContain('✓');
    expect(l0?.actions).toBeUndefined(); // a done lesson offers no verb
    expect(l1?.label).toContain('·');
    expect(l1?.actions).toEqual([{ key: 'd', label: 'done' }]);

    expect(find(roots, 'CS:sessions')).toMatchObject({ expanded: false });
  });

  it('marks a running session with a stop verb', async () => {
    const { api } = setup({ 'open.md': openStudy('OP', 42) });
    const roots = coursesTree(collect(unwrap(await api.list())));
    const open = find(roots, 'OP');
    expect(open?.label).toContain('running');
    expect(open?.actions).toEqual([{ key: 'x', label: 'stop' }]);
  });
});

const courseNode = async (api: PluginApi): Promise<TreeNode> => {
  const roots = coursesTree(collect(unwrap(await api.list())));
  const course = roots.find((n) => n.id === 'CS');
  if (!course) throw new Error('no course node');
  return course;
};

const fileWith = (f: Fixture, needle: string): string | undefined =>
  [...f.fs.files.values()].find((v) => v.includes(needle));

const messageOf = (result: PanelActionResult): string =>
  result !== null && 'message' in result ? result.message : '';

describe('courses.home panel actions', () => {
  const run = async (
    api: PluginApi,
    key: string,
    node: TreeNode,
    inputs?: Record<string, string | number>,
  ) => {
    const action = panel().actions?.find((a) => a.key === key);
    if (!action) throw new Error(`no action ${key}`);
    return action.run(api, { selection: node, ...(inputs && { inputs }) });
  };

  it('loads the tree and marks the focused lesson done', async () => {
    const { f, api } = setup();
    const data = unwrap(await panel().load(api, {})) as Extract<PanelData, { kind: 'tree' }>;
    expect(data.kind).toBe('tree');
    const l1 = find(data.roots, 'L1');
    if (!l1) throw new Error('no L1');
    expect(unwrap(await run(api, 'd', l1))).toMatchObject({ written: true });
    expect(f.fs.files.get('l1.md')).toContain('lesson_status: done');
  });

  it('stops the focused running timer, recording elapsed minutes', async () => {
    const { f, api } = setup({ 'open.md': openStudy('OP', 90) });
    const roots = coursesTree(collect(unwrap(await api.list())));
    const open = find(roots, 'OP');
    if (!open) throw new Error('no open study');
    expect(unwrap(await run(api, 'x', open))).toMatchObject({ written: true });
    expect(f.fs.files.get('open.md')).toContain('study_amount: 90');
    expect(f.fs.files.get('open.md')).toContain('study_ended:');
  });

  it('starts a timer from the course menu verb', async () => {
    const { f, api } = setup();
    const result = unwrap(await run(api, 's', await courseNode(api)));
    expect(messageOf(result)).toContain('Started');
    const study = fileWith(f, 'study_started:');
    expect(study).toContain('study_course: "[[CS]]"');
    expect(study).not.toContain('study_amount');
  });

  it('refuses a second timer', async () => {
    const { api } = setup({ 'open.md': openStudy('OP', 30) });
    expect(await run(api, 's', await courseNode(api))).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
  });

  it('logs time from the course menu verb, using the collected inputs', async () => {
    const { f, api } = setup();
    const result = unwrap(await run(api, 'l', await courseNode(api), { amount: 2, unit: 'hours' }));
    expect(messageOf(result)).toContain('Logged');
    const study = fileWith(f, 'study_amount: 2');
    expect(study).toContain('study_unit: hours');
    expect(study).toContain('study_course: "[[CS]]"');
  });

  it('sets the course target date', async () => {
    const { f, api } = setup();
    expect(
      unwrap(await run(api, 't', await courseNode(api), { date: '2026-12-01' })),
    ).toMatchObject({
      written: true,
    });
    expect(f.fs.files.get('course.md')).toContain('course_target: 2026-12-01');
  });
});

describe('courses.note panel', () => {
  it('shows the focused note’s course as a text outline', async () => {
    const { api } = setup();
    const notePanel = coursesPlugin.panels?.find((p) => p.id === 'courses.note');
    if (!notePanel) throw new Error('no note panel');
    const located = unwrap(await api.read('L1'));
    const data = unwrap(await notePanel.load(api, { note: located })) as Extract<
      PanelData,
      { kind: 'text' }
    >;
    expect(data.kind).toBe('text');
    expect(data.lines[0]).toContain('CS50');
    expect(data.lines.some((l) => l.includes('L1'))).toBe(true);
  });
});
