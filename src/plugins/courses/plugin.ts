import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type {
  CheckResult,
  NotePlugin,
  PluginApi,
  PluginCheck,
} from '../../application/plugin/plugin.js';
import {
  CHAPTER_TYPE,
  collect,
  COURSE_TYPE,
  FIELDS,
  LESSON_TYPE,
  STALE_OPEN_HOURS,
  STUDY_TYPE,
  type CoursesEntries,
} from './model.js';
import { CHAPTER_TEMPLATE, COURSE_TEMPLATE, LESSON_TEMPLATE, STUDY_TEMPLATE } from './templates.js';
import { COMMANDS } from './commands.js';
import { PANELS } from './panels.js';

/*
 * Courses: the content of an online course as a course → chapter → lesson hierarchy, with study
 * sessions alongside it and progress derived from the children (docs/courses.md). Delivery A
 * declared the schema, templates and doctor checks; delivery B adds the commands below. Panels
 * follow in D.
 */

const NAME = 'courses';

const load = async (api: PluginApi): Promise<Result<CoursesEntries, AppError>> => {
  const entries = await api.list();
  return entries.ok ? ok(collect(entries.value)) : entries;
};

/** Owned notes whose metadata the contract rejects; the core's field check says which key. */
const invalidCheck: PluginCheck = {
  kind: 'invalid',
  description:
    'course, chapter, lesson or study notes whose metadata does not satisfy the contract',
  async run(api) {
    const loaded = await load(api);
    if (!loaded.ok) return loaded;
    return ok(
      loaded.value.rejected.map((note): CheckResult => ({
        severity: 'warning',
        vault: note.vault,
        path: note.path,
        message: `${note.title} (${note.type}): ${note.problems.join('; ')}`,
        details: { id: note.id, problems: note.problems },
      })),
    );
  },
};

/** Valid children whose parent reference resolves to nothing in scope (docs/courses.md §3). */
const orphanCheck: PluginCheck = {
  kind: 'orphan',
  description: 'chapters, lessons or study sessions whose parent is not in this scope',
  async run(api) {
    const loaded = await load(api);
    if (!loaded.ok) return loaded;
    const { courses, chapters, lessons, studies } = loaded.value;
    const hasCourse = (id: string, vault: string): boolean =>
      courses.some((c) => c.id === id && c.vault === vault);
    const results: CheckResult[] = [];
    for (const chapter of chapters) {
      if (hasCourse(chapter.course, chapter.vault)) continue;
      results.push({
        severity: 'warning',
        vault: chapter.vault,
        path: chapter.path,
        message: `${chapter.title}: chapter_course names no course in this scope`,
        details: { id: chapter.id, course: chapter.course },
      });
    }
    for (const lesson of lessons) {
      if (chapters.some((c) => c.id === lesson.chapter && c.vault === lesson.vault)) continue;
      results.push({
        severity: 'warning',
        vault: lesson.vault,
        path: lesson.path,
        message: `${lesson.title}: lesson_chapter names no chapter in this scope`,
        details: { id: lesson.id, chapter: lesson.chapter },
      });
    }
    for (const study of studies) {
      const reasons: string[] = [];
      if (!hasCourse(study.course, study.vault)) reasons.push('study_course names no course');
      if (
        study.lesson !== undefined &&
        !lessons.some((l) => l.id === study.lesson && l.vault === study.vault)
      ) {
        reasons.push('study_lesson names no lesson');
      }
      if (reasons.length === 0) continue;
      results.push({
        severity: 'warning',
        vault: study.vault,
        path: study.path,
        message: `${study.title}: ${reasons.join('; ')} in this scope`,
        details: { id: study.id, course: study.course, lesson: study.lesson },
      });
    }
    return ok(results);
  },
};

/** Study timers left running far too long (docs/plans/courses.md, delivery C). */
const openCheck: PluginCheck = {
  kind: 'open',
  description: `study timers running longer than ${String(STALE_OPEN_HOURS)} hours`,
  async run(api) {
    const loaded = await load(api);
    if (!loaded.ok) return loaded;
    const now = api.clock.now().getTime();
    const results: CheckResult[] = [];
    for (const study of loaded.value.studies) {
      if (!study.open || study.started === undefined) continue;
      const hours = (now - study.started.epochMs) / 3_600_000;
      if (hours <= STALE_OPEN_HOURS) continue;
      results.push({
        severity: 'info',
        vault: study.vault,
        path: study.path,
        message: `${study.title}: study timer running for ${String(Math.floor(hours))}h`,
        details: { id: study.id, started: study.started.iso },
      });
    }
    return ok(results);
  },
};

export const coursesPlugin: NotePlugin = {
  name: NAME,
  description: 'an online course as chapters and lessons, with study sessions and derived progress',
  types: [COURSE_TYPE, CHAPTER_TYPE, LESSON_TYPE, STUDY_TYPE],
  fields: FIELDS,
  templates: {
    course: COURSE_TEMPLATE,
    chapter: CHAPTER_TEMPLATE,
    lesson: LESSON_TEMPLATE,
    study: STUDY_TEMPLATE,
  },
  commands: COMMANDS,
  checks: [invalidCheck, orphanCheck, openCheck],
  panels: PANELS,
};
