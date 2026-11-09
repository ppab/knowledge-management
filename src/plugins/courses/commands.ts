import { usage, type AppError } from '../../domain/errors.js';
import { parseIsoDate } from '../../domain/calendar/date-binding.js';
import type { FieldValue } from '../../domain/entry/fields.js';
import { err, ok, type Result } from '../../domain/result.js';
import { isComposite } from '../../domain/scope/scope.js';
import type { PluginApi, PluginCommand } from '../../application/plugin/plugin.js';
import type { IndexedEntry } from '../../application/scope/session.js';
import { isoDate } from '../../application/entries/capture-entry.js';
import {
  collect,
  COURSE_TYPE,
  CHAPTER_TYPE,
  LESSON_TYPE,
  STUDY_TYPE,
  type CoursesEntries,
  type OwnedType,
} from './model.js';
import { courseView, courseViews, formatCourse, formatStudies } from './outline.js';
import { DEFAULT_UNIT, minutesBetween, parseUnit, TIME_UNITS } from './units.js';

/*
 * The courses commands (docs/plans/courses.md, delivery B). Reads go through `api.list()` and
 * `collect`; the two creating verbs (`new`, `log`) write typed fields through `api.capture`, the
 * number a template can only render as a string; `done` is a frontmatter mutation like todos'.
 * A `--dry-run` on a creating verb describes the note instead of writing it.
 */

const loadEntries = async (api: PluginApi): Promise<Result<CoursesEntries, AppError>> => {
  const entries = await api.list();
  return entries.ok ? ok(collect(entries.value)) : entries;
};

/** Resolves a query and requires it to be a note of `type`; a usage error otherwise. */
const resolveOwned = async (
  api: PluginApi,
  query: string,
  type: OwnedType,
): Promise<Result<IndexedEntry, AppError>> => {
  const located = await api.read(query);
  if (!located.ok) return located;
  if (located.value.note.type !== type) {
    return err(
      usage(
        `"${located.value.note.title}" is a ${located.value.note.type ?? 'note'}, not a ${type}`,
      ),
    );
  }
  return located;
};

/** The next `*_order` after the highest already used among the siblings (unordered count as -1). */
const nextOrder = (orders: readonly (number | undefined)[]): number =>
  orders.reduce<number>((max, order) => Math.max(max, order ?? -1), -1) + 1;

const outline: PluginCommand = {
  name: 'outline',
  description: 'show the course → chapter → lesson tree with derived progress',
  args: [{ name: 'course', description: 'one course to show: id, title or alias', optional: true }],
  options: [{ flag: 'status', description: 'keep only lessons of this status', value: 'string' }],
  async run(api, input) {
    const entries = await loadEntries(api);
    if (!entries.ok) return entries;
    const statusRaw = input.options.status;
    const status =
      typeof statusRaw === 'string' &&
      (['todo', 'in-progress', 'done'] as const).includes(statusRaw as never)
        ? (statusRaw as 'todo' | 'in-progress' | 'done')
        : undefined;
    if (statusRaw !== undefined && status === undefined) {
      return err(
        usage(`--status must be todo, in-progress or done, not ${JSON.stringify(statusRaw)}`),
      );
    }
    const vault = isComposite(api.scope);
    let views = courseViews(entries.value);
    const [query] = input.args;
    if (query !== undefined) {
      const located = await resolveOwned(api, query, COURSE_TYPE);
      if (!located.ok) return located;
      views = views.filter((v) => v.course.id === located.value.note.id);
    }
    const lines = views.flatMap((v) => formatCourse(v, { ...(status && { status }), vault }));
    return ok({
      kind: 'lines',
      lines: lines.length > 0 ? lines : ['No courses.'],
      json: { courses: views.map((v) => ({ course: v.course, progress: v.progress })) },
    });
  },
};

const done: PluginCommand = {
  name: 'done',
  description: 'mark a lesson as done',
  args: [{ name: 'lesson', description: 'lesson to complete: id, title or alias' }],
  async run(api, input) {
    const [query] = input.args;
    if (query === undefined) return err(usage('courses done needs a lesson'));
    const located = await resolveOwned(api, query, LESSON_TYPE);
    if (!located.ok) return located;
    const outcome = await api.setFields(
      located.value.note.id,
      { lesson_status: 'done' },
      { dryRun: input.dryRun },
    );
    if (!outcome.ok) return outcome;
    return ok({ kind: 'mutation', outcome: outcome.value });
  },
};

const log: PluginCommand = {
  name: 'log',
  description: 'log study time against a course (creates a study session)',
  args: [
    { name: 'course', description: 'course to log against: id, title or alias' },
    { name: 'amount', description: 'how much time, in --unit' },
  ],
  options: [
    {
      flag: 'lesson',
      description: 'the lesson studied, if a single one: id, title or alias',
      value: 'string',
    },
    { flag: 'unit', description: `minutes (default) or hours`, value: 'string' },
    { flag: 'on', description: 'the work day (YYYY-MM-DD); today by default', value: 'string' },
    { flag: 'title', description: 'a title for the session note', value: 'string' },
  ],
  async run(api, input) {
    const [courseQuery, amountRaw] = input.args;
    if (courseQuery === undefined || amountRaw === undefined) {
      return err(usage('courses log needs a course and an amount'));
    }
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      return err(
        usage(`amount must be a number of zero or more, not ${JSON.stringify(amountRaw)}`),
      );
    }
    const unit = parseUnit(input.options.unit ?? DEFAULT_UNIT);
    if (!unit) return err(usage(`--unit must be one of ${TIME_UNITS.join(', ')}`));
    const course = await resolveOwned(api, courseQuery, COURSE_TYPE);
    if (!course.ok) return course;

    let lessonId: string | undefined;
    if (typeof input.options.lesson === 'string') {
      const lesson = await resolveOwned(api, input.options.lesson, LESSON_TYPE);
      if (!lesson.ok) return lesson;
      lessonId = lesson.value.note.id;
    }
    const day = isoDate(api.clock.now());
    let on = day;
    if (typeof input.options.on === 'string') {
      const parsed = parseIsoDate(input.options.on);
      if (!parsed.ok) return parsed;
      on = parsed.value;
    }
    const title =
      typeof input.options.title === 'string'
        ? input.options.title
        : `${course.value.note.title}, ${on}`;
    const fields: Record<string, FieldValue> = {
      study_amount: amount,
      ...(unit !== DEFAULT_UNIT && { study_unit: unit }),
      ...(lessonId !== undefined && { study_lesson: `[[${lessonId}]]` }),
      ...(on !== day && { dates: [on] }),
    };
    if (input.dryRun) {
      return ok({
        kind: 'lines',
        lines: [`Would log ${amountRaw} ${unit} to ${course.value.note.title} on ${on}`],
        json: { course: course.value.note.id, amount, unit, day: on, lesson: lessonId },
      });
    }
    const created = await api.capture({
      title,
      template: 'courses/study',
      variables: { course: course.value.note.id },
      fields,
      in: course.value.vault.config.name,
    });
    if (!created.ok) return created;
    return ok({
      kind: 'lines',
      lines: [`Logged ${amountRaw} ${unit} to ${course.value.note.title} on ${on}`],
      json: { id: created.value.id, path: created.value.path },
    });
  },
};

const NEW_TYPES = [COURSE_TYPE, CHAPTER_TYPE, LESSON_TYPE] as const;

const newEntry: PluginCommand = {
  name: 'new',
  description: 'create a course, chapter or lesson (study sessions are made with `log`)',
  args: [
    { name: 'type', description: 'course, chapter or lesson' },
    { name: 'title', description: 'the note title' },
  ],
  options: [
    {
      flag: 'course',
      description: 'the parent course (for a chapter): id, title or alias',
      value: 'string',
    },
    {
      flag: 'chapter',
      description: 'the parent chapter (for a lesson): id, title or alias',
      value: 'string',
    },
  ],
  async run(api, input) {
    const [type, title] = input.args;
    if (type === undefined || title === undefined) {
      return err(usage('courses new needs a type and a title'));
    }
    if (!(NEW_TYPES as readonly string[]).includes(type)) {
      return err(usage(`type must be one of ${NEW_TYPES.join(', ')}, not ${JSON.stringify(type)}`));
    }

    const entries = await loadEntries(api);
    if (!entries.ok) return entries;

    let variables: Record<string, string> = {};
    let fields: Record<string, FieldValue> = {};
    let inVault: string | undefined;

    if (type === CHAPTER_TYPE) {
      const courseQuery = input.options.course;
      if (typeof courseQuery !== 'string') return err(usage('a chapter needs --course'));
      const course = await resolveOwned(api, courseQuery, COURSE_TYPE);
      if (!course.ok) return course;
      const parent = course.value.note.id;
      variables = { course: parent };
      fields = {
        chapter_order: nextOrder(
          entries.value.chapters.filter((c) => c.course === parent).map((c) => c.order),
        ),
      };
      inVault = course.value.vault.config.name;
    } else if (type === LESSON_TYPE) {
      const chapterQuery = input.options.chapter;
      if (typeof chapterQuery !== 'string') return err(usage('a lesson needs --chapter'));
      const chapter = await resolveOwned(api, chapterQuery, CHAPTER_TYPE);
      if (!chapter.ok) return chapter;
      const parent = chapter.value.note.id;
      variables = { chapter: parent };
      fields = {
        lesson_order: nextOrder(
          entries.value.lessons.filter((l) => l.chapter === parent).map((l) => l.order),
        ),
      };
      inVault = chapter.value.vault.config.name;
    }

    if (input.dryRun) {
      return ok({
        kind: 'lines',
        lines: [`Would create ${type} "${title}"`],
        json: { type, title, variables, fields },
      });
    }
    const created = await api.capture({
      title,
      template: `courses/${type}`,
      ...(Object.keys(variables).length > 0 && { variables }),
      ...(Object.keys(fields).length > 0 && { fields }),
      ...(inVault !== undefined && { in: inVault }),
    });
    if (!created.ok) return created;
    return ok({
      kind: 'lines',
      lines: [`Created ${type} "${title}" (${created.value.id})`],
      json: { id: created.value.id, path: created.value.path },
    });
  },
};

const start: PluginCommand = {
  name: 'start',
  description: 'start a study timer on a course or lesson',
  args: [{ name: 'target', description: 'the course or lesson to study: id, title or alias' }],
  async run(api, input) {
    const [query] = input.args;
    if (query === undefined) return err(usage('courses start needs a course or lesson'));
    const located = await api.read(query);
    if (!located.ok) return located;
    const note = located.value.note;
    const entries = await loadEntries(api);
    if (!entries.ok) return entries;
    const running = entries.value.studies.find((s) => s.open);
    if (running) {
      return err(usage(`a timer is already running (${running.title}); stop it first`));
    }

    let courseId: string;
    let lessonId: string | undefined;
    if (note.type === COURSE_TYPE) {
      courseId = note.id;
    } else if (note.type === LESSON_TYPE) {
      const lesson = entries.value.lessons.find((l) => l.id === note.id);
      const chapter = lesson && entries.value.chapters.find((c) => c.id === lesson.chapter);
      const course = chapter && entries.value.courses.find((c) => c.id === chapter.course);
      if (!course) return err(usage(`${note.title}'s course is not in this scope`));
      courseId = course.id;
      lessonId = note.id;
    } else {
      return err(
        usage(`${note.title} is a ${note.type ?? 'note'}; start a timer on a course or lesson`),
      );
    }

    if (input.dryRun) {
      return ok({
        kind: 'lines',
        lines: [`Would start a timer on ${note.title}`],
        json: { course: courseId, lesson: lessonId },
      });
    }
    const created = await api.capture({
      title: `${note.title}, ${isoDate(api.clock.now())}`,
      template: 'courses/study',
      variables: { course: courseId },
      fields: {
        study_started: api.clock.now().toISOString(),
        ...(lessonId !== undefined && { study_lesson: `[[${lessonId}]]` }),
      },
      in: located.value.vault.config.name,
    });
    if (!created.ok) return created;
    return ok({
      kind: 'lines',
      lines: [`Started a timer on ${note.title}`],
      json: { id: created.value.id, path: created.value.path },
    });
  },
};

const stop: PluginCommand = {
  name: 'stop',
  description: 'stop the running study timer, recording the elapsed time',
  args: [
    {
      name: 'study',
      description: 'the session to stop, if ambiguous: id, title or alias',
      optional: true,
    },
  ],
  async run(api, input) {
    const entries = await loadEntries(api);
    if (!entries.ok) return entries;
    const open = entries.value.studies.filter((s) => s.open && s.started !== undefined);
    const [query] = input.args;
    let target = open[0];
    if (query !== undefined) {
      const located = await resolveOwned(api, query, STUDY_TYPE);
      if (!located.ok) return located;
      const match = open.find((s) => s.id === located.value.note.id);
      if (!match) return err(usage(`${located.value.note.title} is not a running timer`));
      target = match;
    } else if (open.length === 0) {
      return err(usage('no study timer is running'));
    } else if (open.length > 1) {
      return err(
        usage(`more than one timer is running: ${open.map((s) => s.title).join(', ')}; name one`),
      );
    }
    if (!target?.started) return err(usage('no study timer is running'));

    const minutes = minutesBetween(target.started, api.clock.now().getTime());
    const outcome = await api.setFields(
      target.id,
      { study_ended: api.clock.now().toISOString(), study_amount: minutes },
      { dryRun: input.dryRun },
    );
    if (!outcome.ok) return outcome;
    return ok({ kind: 'mutation', outcome: outcome.value });
  },
};

const show: PluginCommand = {
  name: 'show',
  description: "show one course's outline and its study log",
  args: [{ name: 'course', description: 'the course: id, title or alias' }],
  async run(api, input) {
    const [query] = input.args;
    if (query === undefined) return err(usage('courses show needs a course'));
    const located = await resolveOwned(api, query, COURSE_TYPE);
    if (!located.ok) return located;
    const entries = await loadEntries(api);
    if (!entries.ok) return entries;
    const view = courseView(entries.value, located.value.note.id);
    if (!view) return err(usage(`${located.value.note.title} is not a course in this scope`));
    const studies = formatStudies(view);
    const lines = [
      ...formatCourse(view, { vault: isComposite(api.scope) }),
      '',
      'Study log:',
      ...(studies.length > 0 ? studies : ['  (none logged)']),
    ];
    return ok({
      kind: 'lines',
      lines,
      json: { course: view.course, progress: view.progress, studies: view.studies },
    });
  },
};

export const COMMANDS: readonly PluginCommand[] = [outline, newEntry, log, done, start, stop, show];
