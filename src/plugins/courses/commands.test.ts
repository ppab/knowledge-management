import { describe, expect, it } from 'vitest';
import { createPluginApi } from '../../application/plugin/api.js';
import type { PluginApi, PluginCommand } from '../../application/plugin/plugin.js';
import { buildRegistry, enabledPlugin } from '../../application/plugin/registry.js';
import { diagnose } from '../../application/doctor/diagnose.js';
import { unwrap } from '../../domain/result.js';
import { asEntryId } from '../../domain/entry/entry-id.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { collect } from './model.js';
import { coursesPlugin } from './plugin.js';

/** The fake clock's instant; the timer measures elapsed time against it. */
const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime();
const agoIso = (minutes: number): string => new Date(NOW - minutes * 60000).toISOString();
const openStudy = (id: string, startedMinutesAgo: number): string =>
  [
    '---',
    `id: "${id}"`,
    `title: "${id}"`,
    'type: study',
    'study_course: "[[CS]]"',
    `study_started: "${agoIso(startedMinutesAgo)}"`,
    'dates: ["2026-10-27"]',
    '---',
    '',
  ].join('\n');

/*
 * The courses commands (docs/plans/courses.md, delivery B), exercised against the real
 * frontmatter codec and index through the test fakes, like the contract and todos tests.
 */

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
    `# ${id}`,
    '',
  ].join('\n');

/** CS50 with one chapter (two lessons, one done) and one 90-minute study session. */
const setup = (): { f: Fixture; api: PluginApi } => {
  const f = fixture({ plugins: { courses: {} } });
  f.fs.files.set('course.md', note('CS', 'course', { course_status: 'active' }));
  f.fs.files.set(
    'ch0.md',
    note('CH0', 'chapter', { chapter_course: '"[[CS]]"', chapter_order: '0' }),
  );
  f.fs.files.set(
    'l0.md',
    note('L0', 'lesson', {
      lesson_chapter: '"[[CH0]]"',
      lesson_status: 'done',
      lesson_order: '0',
    }),
  );
  f.fs.files.set(
    'l1.md',
    note('L1', 'lesson', {
      lesson_chapter: '"[[CH0]]"',
      lesson_status: 'todo',
      lesson_order: '1',
    }),
  );
  f.fs.files.set(
    'st0.md',
    note('ST0', 'study', { study_course: '"[[CS]]"', study_amount: '90' }, ['2026-11-08']),
  );
  const registry = unwrap(buildRegistry([coursesPlugin], f.scope));
  const enabled = enabledPlugin(registry, 'courses');
  if (!enabled) throw new Error('courses not enabled');
  return { f, api: createPluginApi(f.deps, registry, enabled) };
};

const command = (name: string): PluginCommand => {
  const found = coursesPlugin.commands?.find((c) => c.name === name);
  if (!found) throw new Error(`no command ${name}`);
  return found;
};

const run = (name: string, api: PluginApi, args: string[], options: Record<string, unknown> = {}) =>
  command(name).run(api, { args, options, dryRun: false });

const dryRun = (
  name: string,
  api: PluginApi,
  args: string[],
  options: Record<string, unknown> = {},
) => command(name).run(api, { args, options, dryRun: true });

const createdFile = (f: Fixture, output: unknown): string => {
  const path = (output as { json: { path: string } }).json.path;
  const file = f.fs.files.get(path);
  if (file === undefined) throw new Error(`no file at ${path}`);
  return file;
};

const linesOf = (output: unknown): string[] => (output as { lines: string[] }).lines;

describe('courses outline', () => {
  it('renders the tree with progress and the lesson glyphs', async () => {
    const { api } = setup();
    const out = unwrap(await run('outline', api, []));
    expect(out.kind).toBe('lines');
    const lines = linesOf(out);
    expect(lines[0]).toContain('CS50');
    expect(lines[0]).toContain('1/2 lessons · 1h30m');
    expect(lines.some((l) => l.includes('✓ L0'))).toBe(true);
    expect(lines.some((l) => l.includes('○ L1'))).toBe(true);
  });

  it('filters lessons by --status and rejects an unknown status', async () => {
    const { api } = setup();
    const done = unwrap(await run('outline', api, [], { status: 'done' }));
    const lines = linesOf(done);
    expect(lines.some((l) => l.includes('✓ L0'))).toBe(true);
    expect(lines.some((l) => l.includes('L1'))).toBe(false);
    expect(await run('outline', api, [], { status: 'maybe' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
  });

  it('scopes to one course when given a query', async () => {
    const { api } = setup();
    const out = unwrap(await run('outline', api, ['CS']));
    expect((out as { json: { courses: unknown[] } }).json.courses).toHaveLength(1);
  });
});

describe('courses done', () => {
  it('marks a lesson done through the mutation path, dry-run included', async () => {
    const { f, api } = setup();
    const dry = unwrap(await dryRun('done', api, ['L1']));
    expect(dry).toMatchObject({ kind: 'mutation', outcome: { written: false, dryRun: true } });
    expect(f.fs.writes).toEqual([]);
    const real = unwrap(await run('done', api, ['L1']));
    expect(real).toMatchObject({ kind: 'mutation', outcome: { written: true } });
    expect(f.fs.files.get('l1.md')).toContain('lesson_status: done');
  });

  it('refuses a target that is not a lesson', async () => {
    const { api } = setup();
    expect(await run('done', api, ['CS'])).toMatchObject({ ok: false, error: { code: 'USAGE' } });
  });
});

describe('courses log', () => {
  it('creates a study session with a numeric amount', async () => {
    const { f, api } = setup();
    const out = unwrap(await run('log', api, ['CS', '45']));
    const file = createdFile(f, out);
    expect(file).toContain('type: study');
    expect(file).toContain('study_course: "[[CS]]"');
    expect(file).toContain('study_amount: 45');
    expect(file).not.toContain('study_unit');
  });

  it('does not collide when logging twice on the same day (unique study paths)', async () => {
    const { f, api } = setup();
    const path = (out: unknown): string => (out as { json: { path: string } }).json.path;
    const p1 = path(unwrap(await run('log', api, ['CS', '30'])));
    const p2 = path(unwrap(await run('log', api, ['CS', '25'])));
    expect(p1).not.toBe(p2);
    expect(p1.startsWith('studies/')).toBe(true);
    expect(f.fs.files.get(p1)).toBeDefined();
    expect(f.fs.files.get(p2)).toBeDefined();
  });

  it('honours --unit, --on and --lesson', async () => {
    const { f, api } = setup();
    const out = unwrap(
      await run('log', api, ['CS', '2'], { unit: 'hours', on: '2026-11-01', lesson: 'L0' }),
    );
    const file = createdFile(f, out);
    expect(file).toContain('study_amount: 2');
    expect(file).toContain('study_unit: hours');
    expect(file).toContain('study_lesson: "[[L0]]"');
    expect(file).toContain('2026-11-01');
  });

  it('does not write on a dry run, and rejects a bad amount or unit', async () => {
    const { f, api } = setup();
    expect(unwrap(await dryRun('log', api, ['CS', '30'])).kind).toBe('lines');
    expect(f.fs.writes).toEqual([]);
    expect(await run('log', api, ['CS', 'lots'])).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(await run('log', api, ['CS', '-5'])).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(await run('log', api, ['CS', '5'], { unit: 'days' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
  });
});

describe('courses new', () => {
  it('creates a course', async () => {
    const { f, api } = setup();
    const out = unwrap(await run('new', api, ['course', 'Rust']));
    const file = createdFile(f, out);
    expect(file).toContain('type: course');
    expect(file).toContain('course_status: active');
  });

  it('creates a chapter under its course and assigns the next order', async () => {
    const { f, api } = setup();
    const out = unwrap(await run('new', api, ['chapter', 'Week 1'], { course: 'CS' }));
    const file = createdFile(f, out);
    expect(file).toContain('chapter_course: "[[CS]]"');
    expect(file).toContain('chapter_order: 1');
  });

  it('creates a lesson under its chapter and assigns the next order', async () => {
    const { f, api } = setup();
    const out = unwrap(await run('new', api, ['lesson', 'Pointers'], { chapter: 'CH0' }));
    const file = createdFile(f, out);
    expect(file).toContain('lesson_chapter: "[[CH0]]"');
    expect(file).toContain('lesson_order: 2');
  });

  it('requires the parent and refuses an unknown type', async () => {
    const { api } = setup();
    expect(await run('new', api, ['chapter', 'x'])).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(await run('new', api, ['lesson', 'x'])).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(await run('new', api, ['study', 'x'])).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
  });
});

describe('courses show', () => {
  it('prints the outline and the study log', async () => {
    const { api } = setup();
    const out = unwrap(await run('show', api, ['CS']));
    const lines = linesOf(out);
    expect(lines[0]).toContain('CS50');
    expect(lines).toContain('Study log:');
    expect(lines.some((l) => l.includes('2026-11-08') && l.includes('1h30m'))).toBe(true);
  });
});

describe('courses start / stop', () => {
  it('starts a timer on a course, as an open study with no amount', async () => {
    const { f, api } = setup();
    const out = unwrap(await run('start', api, ['CS']));
    const file = createdFile(f, out);
    expect(file).toContain('type: study');
    expect(file).toContain('study_course: "[[CS]]"');
    expect(file).toContain('study_started:');
    expect(file).not.toContain('study_amount');
  });

  it('starts a timer on a lesson, resolving its course and linking the lesson', async () => {
    const { f, api } = setup();
    const out = unwrap(await run('start', api, ['L1']));
    const file = createdFile(f, out);
    expect(file).toContain('study_course: "[[CS]]"');
    expect(file).toContain('study_lesson: "[[L1]]"');
  });

  it('refuses a second timer, and refuses a non-course/lesson target', async () => {
    const { f, api } = setup();
    f.fs.files.set('open.md', openStudy('OP', 30));
    expect(await run('start', api, ['CS'])).toMatchObject({ ok: false, error: { code: 'USAGE' } });
    const { api: api2 } = setup();
    expect(await run('start', api2, ['ST0'])).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
  });

  it('stops the running timer, recording the elapsed minutes', async () => {
    const { f, api } = setup();
    f.fs.files.set('open.md', openStudy('OP', 90));
    const out = unwrap(await run('stop', api, []));
    expect(out).toMatchObject({ kind: 'mutation', outcome: { written: true } });
    expect(f.fs.files.get('open.md')).toContain('study_amount: 90');
    expect(f.fs.files.get('open.md')).toContain('study_ended:');
  });

  it('errors with no timer running and with more than one', async () => {
    const { api } = setup();
    expect(await run('stop', api, [])).toMatchObject({ ok: false, error: { code: 'USAGE' } });
    const { f, api: api2 } = setup();
    f.fs.files.set('o1.md', openStudy('O1', 10));
    f.fs.files.set('o2.md', openStudy('O2', 20));
    expect(await run('stop', api2, [])).toMatchObject({ ok: false, error: { code: 'USAGE' } });
  });
});

describe('courses:open doctor check', () => {
  it('reports a timer left running past the stale threshold', async () => {
    const f = fixture({ plugins: { courses: {} } });
    f.fs.files.set(
      'course.md',
      '---\nid: "CS"\ntitle: "CS50"\ntype: course\ncourse_status: active\n---\n',
    );
    f.fs.files.set('stale.md', openStudy('OLD', 13 * 60));
    const registry = unwrap(buildRegistry([coursesPlugin], f.scope));
    const { findings } = unwrap(await diagnose(f.deps, f.scope, registry));
    const open = findings.filter((x) => x.kind === 'courses:open');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ severity: 'info', details: { path: 'stale.md' } });
  });
});

describe('course_target (A′)', () => {
  it('reads a planned finish date and rejects a non-date', () => {
    const good = collect([
      {
        kind: 'entry',
        vault: 'v',
        path: 'c.md',
        id: asEntryId('C1'),
        title: 'C1',
        type: 'course',
        aliases: [],
        dates: [],
        tags: [],
        visibility: 'private',
        version: '',
        issues: [],
        fields: { course_status: 'active', course_target: '2026-12-01' },
      },
    ]);
    expect(good.courses[0]).toMatchObject({ status: 'active', target: '2026-12-01' });

    const bad = collect([
      {
        kind: 'entry',
        vault: 'v',
        path: 'c.md',
        id: asEntryId('C2'),
        title: 'C2',
        type: 'course',
        aliases: [],
        dates: [],
        tags: [],
        visibility: 'private',
        version: '',
        issues: [],
        fields: { course_status: 'active', course_target: 'soon' },
      },
    ]);
    expect(bad.courses).toHaveLength(0);
    expect(bad.rejected[0]?.problems[0]).toContain('course_target must be a date');
  });
});
