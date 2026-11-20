import { describe, expect, it } from 'vitest';
import { asEntryId } from '../../domain/entry/entry-id.js';
import type { Chapter, Course, Lesson, LessonStatus, Study } from './model.js';
import { chaptersOf, courseProgress, formatProgress, lessonsOf, studiesOf } from './progress.js';
import type { TimeUnit } from './units.js';

const course = (overrides: Partial<Course> = {}): Course => ({
  vault: 'v',
  path: 'course.md',
  id: asEntryId('C'),
  title: 'CS50',
  version: '1',
  status: 'active',
  ...overrides,
});

const chapter = (id: string, overrides: Partial<Chapter> = {}): Chapter => ({
  vault: 'v',
  path: `${id}.md`,
  id: asEntryId(id),
  title: id,
  version: '1',
  course: asEntryId('C'),
  ...overrides,
});

const lesson = (id: string, status: LessonStatus, overrides: Partial<Lesson> = {}): Lesson => ({
  vault: 'v',
  path: `${id}.md`,
  id: asEntryId(id),
  title: id,
  version: '1',
  chapter: asEntryId('CH1'),
  status,
  ...overrides,
});

const study = (
  id: string,
  amount: number,
  unit: TimeUnit,
  overrides: Partial<Study> = {},
): Study => ({
  vault: 'v',
  path: `${id}.md`,
  id: asEntryId(id),
  title: id,
  version: '1',
  course: asEntryId('C'),
  amount,
  unit,
  day: '2026-11-08',
  open: false,
  ...overrides,
});

describe('courses progress', () => {
  const chapters: Chapter[] = [
    chapter('CH2', { order: 1 }),
    chapter('CH1', { order: 0 }),
    chapter('CH-ELSEWHERE', { course: asEntryId('OTHER') }),
  ];
  const lessons: Lesson[] = [
    lesson('L2', 'done', { chapter: asEntryId('CH1'), order: 1 }),
    lesson('L1', 'done', { chapter: asEntryId('CH1'), order: 0 }),
    lesson('L3', 'in-progress', { chapter: asEntryId('CH1'), order: 2 }),
    lesson('L4', 'done', { chapter: asEntryId('CH2'), order: 0 }),
    lesson('L5', 'todo', { chapter: asEntryId('CH2'), order: 1 }),
    lesson('L-OTHER', 'done', { chapter: asEntryId('CH-OTHER') }),
  ];

  it('groups chapters and lessons under their parent, in order', () => {
    const c = course();
    expect(chaptersOf(c, chapters).map((x) => x.id)).toEqual(['CH1', 'CH2']);
    expect(lessonsOf(chapter('CH1'), lessons).map((x) => x.id)).toEqual(['L1', 'L2', 'L3']);
  });

  it('counts lessons done over the course total and sums study time', () => {
    const studies: Study[] = [
      study('S1', 90, 'minutes'),
      study('S2', 2, 'hours'),
      study('S-OTHER', 99, 'hours', { course: asEntryId('OTHER') }),
    ];
    const p = courseProgress(course(), chapters, lessons, studies);
    expect(p.totalLessons).toBe(5); // only CH1 + CH2 lessons; CH-OTHER's lesson is unattached
    expect(p.doneLessons).toBe(3);
    expect(p.inProgress).toBe(1);
    expect(p.percent).toBe(60);
    expect(p.studyMinutes).toBe(210); // 90m + 2h
    expect(formatProgress(p)).toBe('3/5 lessons · 3h30m');
    expect(studiesOf(course(), studies).map((s) => s.id)).toEqual(['S1', 'S2']);
  });

  it('shows just lessons before any study time is logged', () => {
    const p = courseProgress(course(), chapters, lessons, []);
    expect(p.studyMinutes).toBe(0);
    expect(formatProgress(p)).toBe('3/5 lessons');
  });

  it('a course with no lessons is 0 percent, not a division by zero', () => {
    const p = courseProgress(course(), [], [], []);
    expect(p.totalLessons).toBe(0);
    expect(p.percent).toBe(0);
    expect(formatProgress(p)).toBe('0/0 lessons');
  });

  it('unordered chapters and lessons sort last, then by title', () => {
    const c = course();
    const withLoose = [chapter('CH-A', { order: 0 }), chapter('Zed'), chapter('Alpha')];
    expect(chaptersOf(c, withLoose).map((x) => x.id)).toEqual(['CH-A', 'Alpha', 'Zed']);
  });
});
