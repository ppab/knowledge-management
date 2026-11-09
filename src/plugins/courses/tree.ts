import type { PanelNoteRef, TreeNode } from '../../application/plugin/plugin.js';
import type { Course, CoursesEntries, Lesson, Study } from './model.js';
import { courseViews, LESSON_GLYPH, type CourseView } from './outline.js';
import { formatProgress, type ChapterProgress } from './progress.js';
import { formatMinutes, toMinutes } from './units.js';

/*
 * The courses tree (docs/plans/courses.md, delivery D): each course splits into a Chapters branch
 * (chapter → lesson, the content) and a Sessions branch (the study log), both synthetic grouping
 * nodes. Initial expansion is derived — an active course and a chapter holding the in-progress
 * lesson open, everything else stays folded — and never stored. Pure: the TUI renders the nodes.
 */

const ref = (n: { vault: string; path: string; id: string }): PanelNoteRef => ({
  vault: n.vault,
  path: n.path,
  id: n.id,
});

const lessonNode = (lesson: Lesson): TreeNode => ({
  id: lesson.id,
  label: `${LESSON_GLYPH[lesson.status]} ${lesson.title}`,
  note: ref(lesson),
  type: 'lesson',
  ...(lesson.status !== 'done' && { actions: [{ key: 'd', label: 'done' }] }),
});

const chapterNode = ({ chapter, lessons, done }: ChapterProgress): TreeNode => ({
  id: chapter.id,
  label: chapter.title,
  detail: `${String(done)}/${String(lessons.length)}`,
  note: ref(chapter),
  type: 'chapter',
  // A chapter opens if it holds the lesson in progress.
  expanded: lessons.some((l) => l.status === 'in-progress'),
  children: lessons.map(lessonNode),
});

const studyNode = (study: Study): TreeNode => ({
  id: study.id,
  label: study.open
    ? '⏱ running'
    : `${study.day}  ${formatMinutes(toMinutes(study.amount ?? 0, study.unit))}`,
  note: ref(study),
  type: 'study',
  ...(study.open && { actions: [{ key: 'x', label: 'stop' }] }),
});

const chaptersBranch = (course: Course, chapters: readonly ChapterProgress[]): TreeNode => ({
  id: `${course.id}:chapters`,
  label: 'Chapters',
  children: chapters.map(chapterNode),
});

const sessionsBranch = (course: Course, studies: readonly Study[]): TreeNode => ({
  id: `${course.id}:sessions`,
  label: `Sessions (${String(studies.length)})`,
  // The study log is secondary; it starts folded even on an active course.
  expanded: false,
  children: studies.map(studyNode),
});

const courseNode = (view: CourseView): TreeNode => ({
  id: view.course.id,
  label: `${view.course.title} · ${view.course.status}`,
  detail: formatProgress(view.progress),
  note: ref(view.course),
  type: 'course',
  expanded: view.course.status === 'active',
  children: [
    chaptersBranch(view.course, view.progress.chapters),
    sessionsBranch(view.course, view.studies),
  ],
});

/** The whole scope as a tree of courses, each with its Chapters and Sessions branches. */
export const coursesTree = (entries: CoursesEntries): TreeNode[] =>
  courseViews(entries).map(courseNode);
