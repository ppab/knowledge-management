import type { CoursesEntries } from './model.js';

/*
 * Small shared resolver for the timer verbs (CLI `start` and the tree's `start` action): the
 * course a target studies under. A course studies under itself; a lesson under its chapter's
 * course. Returns null when the chain leaves the scope.
 */

export interface StudyTarget {
  readonly course: string;
  readonly lesson?: string;
}

export const courseOf = (
  entries: CoursesEntries,
  targetId: string,
  type: string | undefined,
): StudyTarget | null => {
  if (type === 'course') {
    return entries.courses.some((c) => c.id === targetId) ? { course: targetId } : null;
  }
  if (type === 'lesson') {
    const lesson = entries.lessons.find((l) => l.id === targetId);
    const chapter = lesson && entries.chapters.find((c) => c.id === lesson.chapter);
    const course = chapter && entries.courses.find((c) => c.id === chapter.course);
    return course ? { course: course.id, lesson: targetId } : null;
  }
  return null;
};
