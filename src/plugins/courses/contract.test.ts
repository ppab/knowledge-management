import { describe, expect, it } from 'vitest';
import { diagnose, type Finding } from '../../application/doctor/diagnose.js';
import { createPluginApi } from '../../application/plugin/api.js';
import type { PluginApi } from '../../application/plugin/plugin.js';
import { buildRegistry, enabledPlugin } from '../../application/plugin/registry.js';
import { unwrap } from '../../domain/result.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { collect } from './model.js';
import { coursesPlugin } from './plugin.js';

/*
 * The contract (docs/courses.md): the notes under VALID are the courses, chapters, lessons and
 * study sessions the plugin accepts; those under INVALID are rejected with a stated reason. They
 * go through the real frontmatter codec and index, not a fake parser, and the registry and
 * `doctor` are the real ones.
 */

const note = (
  id: string | null,
  type: string,
  fields: Record<string, string>,
  dates?: readonly string[],
): string => {
  const lines = [
    '---',
    ...(id === null ? [] : [`id: "${id}"`]),
    `title: "${id ?? type}"`,
    `type: ${type}`,
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    ...(dates ? [`dates: [${dates.map((d) => `"${d}"`).join(', ')}]`] : []),
    '---',
    '',
    `# ${id ?? type}`,
    '',
  ];
  return lines.join('\n');
};

const VALID: Record<string, string> = {
  'valid/course.md': note('COURSE', 'course', {
    course_status: 'active',
    course_provider: 'edX',
  }),
  'valid/chapter.md': note('CH0', 'chapter', {
    chapter_course: '"[[COURSE]]"',
    chapter_order: '0',
  }),
  'valid/lesson-done.md': note('L0', 'lesson', {
    lesson_chapter: '"[[CH0]]"',
    lesson_status: 'done',
    lesson_order: '0',
  }),
  'valid/lesson-wip.md': note('L1', 'lesson', {
    lesson_chapter: '"[[CH0]]"',
    lesson_status: 'in-progress',
    lesson_order: '1',
  }),
  'valid/study.md': note('ST0', 'study', { study_course: '"[[COURSE]]"', study_amount: '90' }, [
    '2026-11-08',
  ]),
  // Accepted (its metadata is well-formed) but orphaned: its parent is not in this scope.
  'valid/chapter-orphan.md': note('CHX', 'chapter', { chapter_course: '"[[GHOST]]"' }),
  'valid/study-ghost-lesson.md': note(
    'STX',
    'study',
    { study_course: '"[[COURSE]]"', study_lesson: '"[[GHOSTL]]"', study_amount: '30' },
    ['2026-11-08'],
  ),
};

const INVALID: Record<string, string> = {
  'invalid/course-no-status.md': note('CBAD', 'course', { course_provider: 'Udemy' }),
  'invalid/lesson-bad-status.md': note('LBAD', 'lesson', {
    lesson_chapter: '"[[CH0]]"',
    lesson_status: 'meh',
  }),
  'invalid/study-no-amount.md': note('STBAD', 'study', { study_course: '"[[COURSE]]"' }, [
    '2026-11-08',
  ]),
  // No id: unidentified for the core, invisible to the plugin.
  'invalid/study-unidentified.md': note(null, 'study', { study_course: '"[[COURSE]]"' }, [
    '2026-11-08',
  ]),
};

const setup = (): { f: Fixture; api: PluginApi } => {
  const f = fixture({ plugins: { courses: {} } });
  for (const [path, source] of [...Object.entries(VALID), ...Object.entries(INVALID)]) {
    f.fs.files.set(path, source);
  }
  const registry = unwrap(buildRegistry([coursesPlugin], f.scope));
  const enabled = enabledPlugin(registry, 'courses');
  if (!enabled) throw new Error('courses not enabled');
  return { f, api: createPluginApi(f.deps, registry, enabled) };
};

const ofKind = (findings: readonly Finding[], kind: string) =>
  findings
    .filter((x) => x.kind === kind)
    .map((x) => String(x.details.path))
    .sort((a, b) => a.localeCompare(b));

describe('courses contract', () => {
  it('accepts every well-formed note and rejects the rest with reasons', async () => {
    const { api } = setup();
    const { courses, chapters, lessons, studies, rejected } = collect(unwrap(await api.list()));
    expect(courses.map((c) => c.id)).toEqual(['COURSE']);
    expect(chapters.map((c) => c.id).sort()).toEqual(['CH0', 'CHX']);
    expect(lessons.map((l) => l.id).sort()).toEqual(['L0', 'L1']);
    expect(studies.map((s) => s.id).sort()).toEqual(['ST0', 'STX']);

    const problems = Object.fromEntries(rejected.map((r) => [r.path, r.problems.join('; ')]));
    expect(problems).toEqual({
      'invalid/course-no-status.md':
        'course_status must be one of active, completed, paused, dropped, got undefined',
      'invalid/lesson-bad-status.md':
        'lesson_status must be one of todo, in-progress, done, got "meh"',
      'invalid/study-no-amount.md': 'a study session needs study_amount',
    });
  });

  it('reads the fields as the contract defines them', async () => {
    const { api } = setup();
    const { courses, lessons, studies } = collect(unwrap(await api.list()));
    expect(courses.find((c) => c.id === 'COURSE')).toMatchObject({
      status: 'active',
      provider: 'edX',
    });
    expect(lessons.find((l) => l.id === 'L0')).toMatchObject({
      chapter: 'CH0',
      status: 'done',
      order: 0,
    });
    expect(studies.find((s) => s.id === 'ST0')).toMatchObject({
      course: 'COURSE',
      amount: 90,
      unit: 'minutes',
      day: '2026-11-08',
    });
  });

  it('doctor reports rejected notes and orphaned children, and the core flags the fields', async () => {
    const { f } = setup();
    const registry = unwrap(buildRegistry([coursesPlugin], f.scope));
    const { findings } = unwrap(await diagnose(f.deps, f.scope, registry));

    expect(ofKind(findings, 'courses:invalid')).toEqual([
      'invalid/course-no-status.md',
      'invalid/lesson-bad-status.md',
      'invalid/study-no-amount.md',
    ]);
    expect(ofKind(findings, 'courses:orphan')).toEqual([
      'valid/chapter-orphan.md',
      'valid/study-ghost-lesson.md',
    ]);
    expect(ofKind(findings, 'unidentified')).toEqual(['invalid/study-unidentified.md']);

    // The core's declared-field check names the offending key on the owned notes.
    const fields = findings
      .filter((x) => x.kind === 'field')
      .map((x) => `${String(x.details.path)} ${String(x.details.field)}`);
    expect(fields).toContain('invalid/course-no-status.md course_status');
    expect(fields).toContain('invalid/lesson-bad-status.md lesson_status');
    expect(f.fs.writes).toEqual([]);
  });

  it('the built-in templates write notes whose parent links are field references', async () => {
    const { api } = setup();
    const course = unwrap(await api.create({ title: 'Rust', template: 'courses/course' }));
    expect(course.frontmatter).toMatchObject({ type: 'course', course_status: 'active' });

    const chapter = unwrap(
      await api.create({
        title: 'Ownership',
        template: 'courses/chapter',
        variables: { course: 'COURSE' },
      }),
    );
    expect(chapter.frontmatter).toMatchObject({ type: 'chapter', chapter_course: '[[COURSE]]' });

    const study = unwrap(
      await api.create({
        title: 'Morning',
        template: 'courses/study',
        variables: { course: 'COURSE' },
      }),
    );
    expect(study.frontmatter).toMatchObject({
      type: 'study',
      study_course: '[[COURSE]]',
      dates: ['2026-10-27'],
    });
  });
});
