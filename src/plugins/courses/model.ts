import type { ScopedEntry } from '../../application/notes/list-notes.js';
import type { FieldSpec } from '../../application/plugin/plugin.js';
import { parseIsoDate, type IsoDate } from '../../domain/calendar/date-binding.js';
import type { FieldValue } from '../../domain/note/fields.js';
import type { NoteId } from '../../domain/note/note-id.js';
import { parseFieldReference } from '../../domain/reference/reference.js';
import { DEFAULT_UNIT, parseInstant, parseUnit, type Instant, type TimeUnit } from './units.js';

/*
 * The Courses schema (docs/courses.md §1): four owned types and strict readers from index
 * entries. Like goals, a note whose metadata does not satisfy the contract is not read
 * leniently — it is rejected with the reasons, so nothing half-understood reaches the progress
 * rule (progress.ts). Validation of what a file *says* is `doctor`'s; what counts is decided here.
 */

export const COURSE_TYPE = 'course';
export const CHAPTER_TYPE = 'chapter';
export const LESSON_TYPE = 'lesson';
export const STUDY_TYPE = 'study';

export const COURSE_STATUSES = ['active', 'completed', 'paused', 'dropped'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const LESSON_STATUSES = ['todo', 'in-progress', 'done'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/** A running study (timer started, not yet stopped) older than this is flagged by `doctor`. */
export const STALE_OPEN_HOURS = 12;

export const COURSE_FIELDS: readonly FieldSpec[] = [
  {
    name: 'course_provider',
    types: [COURSE_TYPE],
    type: 'string',
    description: 'the platform the course is on (edX, Coursera, a YouTube channel…)',
  },
  {
    name: 'course_url',
    types: [COURSE_TYPE],
    type: 'string',
    description: 'the course home page',
  },
  {
    name: 'course_instructor',
    types: [COURSE_TYPE],
    type: 'string',
    description: 'who teaches it',
  },
  {
    name: 'course_status',
    types: [COURSE_TYPE],
    type: 'enum',
    values: COURSE_STATUSES,
    required: true,
    description: 'active, completed, paused or dropped',
  },
  {
    name: 'course_target',
    types: [COURSE_TYPE],
    type: 'date',
    description: 'a planned finish date; progress stays derived, this is only the plan',
  },
];

export const CHAPTER_FIELDS: readonly FieldSpec[] = [
  {
    name: 'chapter_course',
    types: [CHAPTER_TYPE],
    type: 'reference',
    required: true,
    description: 'the course this chapter belongs to, as "[[id]]"',
  },
  {
    name: 'chapter_order',
    types: [CHAPTER_TYPE],
    type: 'number',
    description: 'position within the course; unordered chapters sort last',
  },
];

export const LESSON_FIELDS: readonly FieldSpec[] = [
  {
    name: 'lesson_chapter',
    types: [LESSON_TYPE],
    type: 'reference',
    required: true,
    description: 'the chapter this lesson belongs to, as "[[id]]"',
  },
  {
    name: 'lesson_status',
    types: [LESSON_TYPE],
    type: 'enum',
    values: LESSON_STATUSES,
    required: true,
    description: 'todo, in-progress or done',
  },
  {
    name: 'lesson_order',
    types: [LESSON_TYPE],
    type: 'number',
    description: 'position within the chapter; unordered lessons sort last',
  },
  {
    name: 'lesson_url',
    types: [LESSON_TYPE],
    type: 'string',
    description: 'a direct link to the lesson (video, page…)',
  },
  {
    name: 'lesson_duration',
    types: [LESSON_TYPE],
    type: 'number',
    description: "the lesson's length in minutes",
  },
];

export const STUDY_FIELDS: readonly FieldSpec[] = [
  {
    name: 'study_course',
    types: [STUDY_TYPE],
    type: 'reference',
    required: true,
    description: 'the course this session counts toward, as "[[id]]"',
  },
  {
    name: 'study_lesson',
    types: [STUDY_TYPE],
    type: 'reference',
    description: 'the lesson studied, if a single one, as "[[id]]"',
  },
  {
    name: 'study_amount',
    types: [STUDY_TYPE],
    type: 'number',
    description: 'time studied, in study_unit',
  },
  {
    name: 'study_unit',
    types: [STUDY_TYPE],
    type: 'string',
    description: 'minutes (default) or hours',
  },
  {
    name: 'study_started',
    types: [STUDY_TYPE],
    type: 'string',
    description: 'ISO 8601 instant with offset; scaffolding for a future timer, unused today',
  },
  {
    name: 'study_ended',
    types: [STUDY_TYPE],
    type: 'string',
    description: 'ISO 8601 instant with offset; scaffolding for a future timer, unused today',
  },
];

export const FIELDS: readonly FieldSpec[] = [
  ...COURSE_FIELDS,
  ...CHAPTER_FIELDS,
  ...LESSON_FIELDS,
  ...STUDY_FIELDS,
];

interface Identity {
  readonly vault: string;
  readonly path: string;
  readonly id: NoteId;
  readonly title: string;
  /** Content version at read time; what a mutation passes as `expectedVersion`. */
  readonly version: string;
}

export interface Course extends Identity {
  readonly status: CourseStatus;
  readonly provider?: string;
  readonly url?: string;
  readonly instructor?: string;
  /** A planned finish date; the plan only — progress is still derived from children. */
  readonly target?: IsoDate;
}

export interface Chapter extends Identity {
  readonly course: NoteId;
  readonly order?: number;
}

export interface Lesson extends Identity {
  readonly chapter: NoteId;
  readonly status: LessonStatus;
  readonly order?: number;
  readonly url?: string;
  readonly duration?: number;
}

export interface Study extends Identity {
  readonly course: NoteId;
  readonly lesson?: NoteId;
  /** Minutes/hours studied; absent only while the timer is running. */
  readonly amount?: number;
  readonly unit: TimeUnit;
  /** The work day: the first `dates:` binding. */
  readonly day: IsoDate;
  readonly started?: Instant;
  readonly ended?: Instant;
  /** The timer is running: `study_started` is set, with no `study_ended` and no `study_amount`. */
  readonly open: boolean;
}

export type OwnedType =
  typeof COURSE_TYPE | typeof CHAPTER_TYPE | typeof LESSON_TYPE | typeof STUDY_TYPE;

/**
 * An owned note whose metadata does not satisfy the contract. Only identified notes get here:
 * an unidentified file has no `type` in its summary, so the core's `unidentified` finding is the
 * one that reports it.
 */
export interface Rejected extends Identity {
  readonly type: OwnedType;
  readonly problems: readonly string[];
}

export interface CoursesEntries {
  readonly courses: readonly Course[];
  readonly chapters: readonly Chapter[];
  readonly lessons: readonly Lesson[];
  readonly studies: readonly Study[];
  readonly rejected: readonly Rejected[];
}

type Fields = Readonly<Record<string, FieldValue>>;

const present = (value: FieldValue | undefined): value is FieldValue =>
  value !== undefined && value !== null;

const finiteNumber = (value: FieldValue): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const enumValue = <T extends string>(
  values: readonly T[],
  value: FieldValue | undefined,
): T | undefined =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

/** Reads an optional free-text field, pushing a problem when it is present but not a string. */
const optionalText = (fields: Fields, key: string, problems: string[]): string | undefined => {
  if (!present(fields[key])) return undefined;
  if (typeof fields[key] === 'string') return fields[key];
  problems.push(`${key} must be text`);
  return undefined;
};

/** Reads an optional count (zero or more), pushing a problem when it is present but invalid. */
const optionalCount = (fields: Fields, key: string, problems: string[]): number | undefined => {
  if (!present(fields[key])) return undefined;
  if (finiteNumber(fields[key]) && fields[key] >= 0) return fields[key];
  problems.push(`${key} must be a number of zero or more, got ${JSON.stringify(fields[key])}`);
  return undefined;
};

const readCourse = (
  fields: Fields,
): { readonly course: Omit<Course, keyof Identity> | null; readonly problems: string[] } => {
  const problems: string[] = [];
  const status = enumValue(COURSE_STATUSES, fields.course_status);
  if (!status) {
    problems.push(
      `course_status must be one of ${COURSE_STATUSES.join(', ')}, got ${JSON.stringify(fields.course_status)}`,
    );
  }
  const provider = optionalText(fields, 'course_provider', problems);
  const url = optionalText(fields, 'course_url', problems);
  const instructor = optionalText(fields, 'course_instructor', problems);
  let target: IsoDate | undefined;
  if (present(fields.course_target)) {
    const parsed =
      typeof fields.course_target === 'string' ? parseIsoDate(fields.course_target) : null;
    if (parsed?.ok) target = parsed.value;
    else
      problems.push(
        `course_target must be a date (YYYY-MM-DD), got ${JSON.stringify(fields.course_target)}`,
      );
  }
  if (problems.length > 0 || !status) return { course: null, problems };
  return {
    course: {
      status,
      ...(provider !== undefined && { provider }),
      ...(url !== undefined && { url }),
      ...(instructor !== undefined && { instructor }),
      ...(target !== undefined && { target }),
    },
    problems,
  };
};

const readChapter = (
  fields: Fields,
): { readonly chapter: Omit<Chapter, keyof Identity> | null; readonly problems: string[] } => {
  const problems: string[] = [];
  const course = parseFieldReference(fields.chapter_course);
  if (!course) problems.push('chapter_course must be a note link ("[[id]]")');
  const order = optionalCount(fields, 'chapter_order', problems);
  if (problems.length > 0 || !course) return { chapter: null, problems };
  return {
    chapter: { course: course.target, ...(order !== undefined && { order }) },
    problems,
  };
};

const readLesson = (
  fields: Fields,
): { readonly lesson: Omit<Lesson, keyof Identity> | null; readonly problems: string[] } => {
  const problems: string[] = [];
  const chapter = parseFieldReference(fields.lesson_chapter);
  if (!chapter) problems.push('lesson_chapter must be a note link ("[[id]]")');
  const status = enumValue(LESSON_STATUSES, fields.lesson_status);
  if (!status) {
    problems.push(
      `lesson_status must be one of ${LESSON_STATUSES.join(', ')}, got ${JSON.stringify(fields.lesson_status)}`,
    );
  }
  const order = optionalCount(fields, 'lesson_order', problems);
  const url = optionalText(fields, 'lesson_url', problems);
  const duration = optionalCount(fields, 'lesson_duration', problems);
  if (problems.length > 0 || !chapter || !status) return { lesson: null, problems };
  return {
    lesson: {
      chapter: chapter.target,
      status,
      ...(order !== undefined && { order }),
      ...(url !== undefined && { url }),
      ...(duration !== undefined && { duration }),
    },
    problems,
  };
};

const readStudy = (
  fields: Fields,
  dates: readonly string[],
): { readonly study: Omit<Study, keyof Identity> | null; readonly problems: string[] } => {
  const problems: string[] = [];
  const course = parseFieldReference(fields.study_course);
  if (!course) problems.push('study_course must be a note link ("[[id]]")');
  let lesson: NoteId | undefined;
  if (present(fields.study_lesson)) {
    const reference = parseFieldReference(fields.study_lesson);
    if (reference) lesson = reference.target;
    else problems.push('study_lesson must be a note link ("[[id]]")');
  }
  let amount: number | undefined;
  if (present(fields.study_amount)) {
    if (finiteNumber(fields.study_amount) && fields.study_amount >= 0) {
      amount = fields.study_amount;
    } else {
      problems.push(
        `study_amount must be a number of zero or more, got ${JSON.stringify(fields.study_amount)}`,
      );
    }
  }
  let unit: TimeUnit = DEFAULT_UNIT;
  if (present(fields.study_unit)) {
    const parsed = parseUnit(fields.study_unit);
    if (parsed) unit = parsed;
    else problems.push('study_unit must be minutes or hours');
  }
  let started: Instant | undefined;
  if (present(fields.study_started)) {
    const parsed = parseInstant(fields.study_started);
    if (parsed) started = parsed;
    else problems.push('study_started must be an ISO 8601 instant');
  }
  let ended: Instant | undefined;
  if (present(fields.study_ended)) {
    const parsed = parseInstant(fields.study_ended);
    if (parsed) ended = parsed;
    else problems.push('study_ended must be an ISO 8601 instant');
  }
  // A session is a running timer when it has a start, no end and no amount; otherwise it is a
  // completed record and must carry study_amount.
  const open = started !== undefined && ended === undefined && amount === undefined;
  if (!open && amount === undefined) {
    problems.push('a study session needs study_amount (or study_started while the timer runs)');
  }
  if (ended !== undefined && started === undefined) {
    problems.push('study_ended needs study_started');
  }
  if (started && ended && ended.epochMs < started.epochMs) {
    problems.push('study_ended is before study_started');
  }
  const day = dates[0];
  if (day === undefined) problems.push('a study session needs its day in dates:');
  if (problems.length > 0 || !course || day === undefined) {
    return { study: null, problems };
  }
  return {
    study: {
      course: course.target,
      unit,
      day,
      open,
      ...(amount !== undefined && { amount }),
      ...(lesson !== undefined && { lesson }),
      ...(started !== undefined && { started }),
      ...(ended !== undefined && { ended }),
    },
    problems,
  };
};

/** Splits a scope's entries into the valid owned notes and the rejected ones of each type. */
export const collect = (entries: readonly ScopedEntry[]): CoursesEntries => {
  const courses: Course[] = [];
  const chapters: Chapter[] = [];
  const lessons: Lesson[] = [];
  const studies: Study[] = [];
  const rejected: Rejected[] = [];
  for (const entry of entries) {
    const type = entry.type;
    if (
      type !== COURSE_TYPE &&
      type !== CHAPTER_TYPE &&
      type !== LESSON_TYPE &&
      type !== STUDY_TYPE
    ) {
      continue;
    }
    if (entry.kind !== 'note') continue;
    const identity: Identity = {
      vault: entry.vault,
      path: entry.path,
      id: entry.id,
      title: entry.title,
      version: entry.version,
    };
    if (type === COURSE_TYPE) {
      const read = readCourse(entry.fields);
      if (read.course) courses.push({ ...identity, ...read.course });
      else rejected.push({ ...identity, type, problems: read.problems });
    } else if (type === CHAPTER_TYPE) {
      const read = readChapter(entry.fields);
      if (read.chapter) chapters.push({ ...identity, ...read.chapter });
      else rejected.push({ ...identity, type, problems: read.problems });
    } else if (type === LESSON_TYPE) {
      const read = readLesson(entry.fields);
      if (read.lesson) lessons.push({ ...identity, ...read.lesson });
      else rejected.push({ ...identity, type, problems: read.problems });
    } else {
      const read = readStudy(entry.fields, entry.dates);
      if (read.study) studies.push({ ...identity, ...read.study });
      else rejected.push({ ...identity, type, problems: read.problems });
    }
  }
  return { courses, chapters, lessons, studies, rejected };
};
