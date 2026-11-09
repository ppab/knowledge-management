import type { CoursesEntries, Course, LessonStatus, Study } from './model.js';
import { courseProgress, studiesOf, type CourseProgress } from './progress.js';
import { formatMinutes, toMinutes } from './units.js';

/*
 * The outline view (docs/plans/courses.md): a course with its derived progress and its study
 * sessions, built once from the collected entries and reused by the `outline`/`show` commands
 * (and, later, the tree screen). Pure — it reads, never writes, and excludes the invalid notes
 * the same way progress does.
 */

/** The glyph a lesson's status shows in the tree. */
export const LESSON_GLYPH: Readonly<Record<LessonStatus, string>> = {
  done: '✓',
  'in-progress': '·',
  todo: '○',
};

export interface CourseView {
  readonly course: Course;
  readonly progress: CourseProgress;
  /** The course's study sessions, newest day first. */
  readonly studies: readonly Study[];
}

const byDayDesc = (a: Study, b: Study): number =>
  b.day.localeCompare(a.day) || a.title.localeCompare(b.title);

/** Every course in scope as a view, courses sorted by title. */
export const courseViews = (entries: CoursesEntries): CourseView[] =>
  entries.courses
    .map((course): CourseView => ({
      course,
      progress: courseProgress(course, entries.chapters, entries.lessons, entries.studies),
      studies: [...studiesOf(course, entries.studies)].sort(byDayDesc),
    }))
    .sort((a, b) => a.course.title.localeCompare(b.course.title));

/** One course view by id, or `undefined` when no such course is in scope. */
export const courseView = (entries: CoursesEntries, id: string): CourseView | undefined =>
  courseViews(entries).find((v) => v.course.id === id);

export interface OutlineOptions {
  /** Keep only lessons of this status in the rendered tree; all when absent. */
  readonly status?: LessonStatus;
  /** Prefix the course line with its vault (a composite scope). */
  readonly vault?: boolean;
}

/** `3/24 lessons · 6h30m`, with the study time only once any is logged. */
const headline = (view: CourseView): string => {
  const { doneLessons, totalLessons, studyMinutes } = view.progress;
  const lessons = `${String(doneLessons)}/${String(totalLessons)} lessons`;
  return studyMinutes > 0 ? `${lessons} · ${formatMinutes(studyMinutes)}` : lessons;
};

/** The `course → chapter → lesson` tree of one course as display lines. */
export const formatCourse = (view: CourseView, options: OutlineOptions = {}): string[] => {
  const prefix = options.vault ? `[${view.course.vault}] ` : '';
  const lines = [`${prefix}${view.course.title}  ·  ${headline(view)}  ·  ${view.course.status}`];
  for (const { chapter, lessons, done } of view.progress.chapters) {
    const shown = options.status ? lessons.filter((l) => l.status === options.status) : lessons;
    if (options.status && shown.length === 0) continue;
    const order = chapter.order === undefined ? ' ' : String(chapter.order);
    lines.push(`  ${order}  ${chapter.title}        ${String(done)}/${String(lessons.length)}`);
    for (const lesson of shown) {
      lines.push(`     ${LESSON_GLYPH[lesson.status]} ${lesson.title}`);
    }
  }
  return lines;
};

/** The study sessions of one course as display lines, newest first. */
export const formatStudies = (view: CourseView): string[] =>
  view.studies.map((s) => `  ${s.day}  ${formatMinutes(toMinutes(s.amount, s.unit))}`);
