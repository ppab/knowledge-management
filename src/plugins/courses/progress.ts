import type { Chapter, Course, Lesson, Study } from './model.js';
import { formatMinutes, toMinutes } from './units.js';

/*
 * Course progress (docs/courses.md §2), derived from child notes — never a counter on the
 * course. Two faces: lessons done over total, and total study time. The chapter/lesson tree is
 * built by matching each child's parent reference to its parent id, then sorted by the numeric
 * order field (unordered children sort last, then by title).
 */

/** Unordered children sort after ordered ones. */
const ORDER_LAST = Number.MAX_SAFE_INTEGER;

const byOrder = <T extends { readonly order?: number; readonly title: string }>(
  a: T,
  b: T,
): number => (a.order ?? ORDER_LAST) - (b.order ?? ORDER_LAST) || a.title.localeCompare(b.title);

export const chaptersOf = (course: Course, chapters: readonly Chapter[]): Chapter[] =>
  chapters.filter((c) => c.course === course.id && c.vault === course.vault).sort(byOrder);

export const lessonsOf = (chapter: Chapter, lessons: readonly Lesson[]): Lesson[] =>
  lessons.filter((l) => l.chapter === chapter.id && l.vault === chapter.vault).sort(byOrder);

export const studiesOf = (course: Course, studies: readonly Study[]): Study[] =>
  studies.filter((s) => s.course === course.id && s.vault === course.vault);

export interface ChapterProgress {
  readonly chapter: Chapter;
  /** The chapter's lessons, in order. */
  readonly lessons: readonly Lesson[];
  readonly done: number;
}

export interface CourseProgress {
  readonly course: Course;
  readonly totalLessons: number;
  readonly doneLessons: number;
  readonly inProgress: number;
  /** Whole percent of lessons done, 0 when the course has no lessons yet. */
  readonly percent: number;
  /** Total confirmed study time, in minutes. */
  readonly studyMinutes: number;
  readonly chapters: readonly ChapterProgress[];
}

export const courseProgress = (
  course: Course,
  chapters: readonly Chapter[],
  lessons: readonly Lesson[],
  studies: readonly Study[],
): CourseProgress => {
  const chapterProgress = chaptersOf(course, chapters).map((chapter): ChapterProgress => {
    const own = lessonsOf(chapter, lessons);
    return { chapter, lessons: own, done: own.filter((l) => l.status === 'done').length };
  });
  const all = chapterProgress.flatMap((c) => c.lessons);
  const totalLessons = all.length;
  const doneLessons = all.filter((l) => l.status === 'done').length;
  const studyMinutes = studiesOf(course, studies).reduce(
    (sum, s) => sum + toMinutes(s.amount, s.unit),
    0,
  );
  return {
    course,
    totalLessons,
    doneLessons,
    inProgress: all.filter((l) => l.status === 'in-progress').length,
    percent: totalLessons === 0 ? 0 : Math.floor((doneLessons / totalLessons) * 100),
    studyMinutes,
    chapters: chapterProgress,
  };
};

/** `3/24 lessons`, or `3/24 lessons · 3h30m` once any study time is logged. */
export const formatProgress = (progress: CourseProgress): string => {
  const lessons = `${String(progress.doneLessons)}/${String(progress.totalLessons)} lessons`;
  return progress.studyMinutes > 0
    ? `${lessons} · ${formatMinutes(progress.studyMinutes)}`
    : lessons;
};
