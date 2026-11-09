import { describe, expect, it } from 'vitest';
import { createPluginApi } from '../../application/plugin/api.js';
import type { PluginApi, PluginCommand } from '../../application/plugin/plugin.js';
import { buildRegistry, enabledPlugin } from '../../application/plugin/registry.js';
import { unwrap } from '../../domain/result.js';
import { asNoteId } from '../../domain/note/note-id.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { collect } from './model.js';
import { coursesPlugin } from './plugin.js';

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

describe('course_target (A′)', () => {
  it('reads a planned finish date and rejects a non-date', () => {
    const good = collect([
      {
        kind: 'note',
        vault: 'v',
        path: 'c.md',
        id: asNoteId('C1'),
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
        kind: 'note',
        vault: 'v',
        path: 'c.md',
        id: asNoteId('C2'),
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
