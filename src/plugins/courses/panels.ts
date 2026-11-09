import { usage, type AppError } from '../../domain/errors.js';
import { parseIsoDate } from '../../domain/calendar/date-binding.js';
import type { FieldValue } from '../../domain/entry/fields.js';
import { err, ok, type Result } from '../../domain/result.js';
import type {
  PanelAction,
  PanelContext,
  PanelData,
  PanelEntryRef,
  PanelSpec,
  PluginApi,
  TreeNode,
} from '../../application/plugin/plugin.js';
import { collect, type CoursesEntries } from './model.js';
import { courseView, LESSON_GLYPH, type CourseView } from './outline.js';
import { formatProgress } from './progress.js';
import { coursesTree } from './tree.js';
import { courseOf } from './study.js';
import { minutesBetween } from './units.js';

/*
 * The courses tree screen (docs/plans/courses.md, delivery D). The home panel is the collapsible
 * course tree; its inline verbs (`d` done, `x` stop) edit the focused node, and its leader-menu
 * verbs (`s` start, `l` log, `t` set target), scoped to the node's type, create or set through the
 * input form. A note-side panel shows the focused note's course as a subtree.
 */

const node = (context: PanelContext): TreeNode | undefined =>
  context.selection as TreeNode | undefined;

const load = async (api: PluginApi): Promise<Result<CoursesEntries, AppError>> => {
  const entries = await api.list();
  return entries.ok ? ok(collect(entries.value)) : entries;
};

const loadTree = async (api: PluginApi): Promise<Result<PanelData, AppError>> => {
  const entries = await load(api);
  return entries.ok ? ok({ kind: 'tree', roots: coursesTree(entries.value) }) : entries;
};

/** Mark the focused lesson done. */
const doneAction: PanelAction = {
  key: 'd',
  label: 'done',
  appliesTo: ['lesson'],
  surface: 'inline',
  async run(api, context) {
    const id = node(context)?.note?.id;
    if (id === undefined) return ok(null);
    return api.setFields(id, { lesson_status: 'done' });
  },
};

/** Stop the focused running timer, recording the elapsed minutes. */
const stopAction: PanelAction = {
  key: 'x',
  label: 'stop',
  appliesTo: ['study'],
  surface: 'inline',
  async run(api, context) {
    const id = node(context)?.note?.id;
    if (id === undefined) return ok(null);
    const entries = await load(api);
    if (!entries.ok) return entries;
    const study = entries.value.studies.find((s) => s.id === id);
    if (study?.open !== true || study.started === undefined) return ok(null);
    return api.setFields(id, {
      study_ended: api.clock.now().toISOString(),
      study_amount: minutesBetween(study.started, api.clock.now().getTime()),
    });
  },
};

/** Start a study timer on the focused course or lesson. */
const startAction: PanelAction = {
  key: 's',
  label: 'start timer',
  appliesTo: ['course', 'lesson'],
  surface: 'menu',
  async run(api, context) {
    const focused = node(context);
    const id = focused?.note?.id;
    if (id === undefined) return ok(null);
    const entries = await load(api);
    if (!entries.ok) return entries;
    if (entries.value.studies.some((s) => s.open)) {
      return err(usage('a timer is already running; stop it first'));
    }
    const target = courseOf(entries.value, id, focused?.type);
    if (!target) return err(usage('this note’s course is not in this scope'));
    const created = await api.capture({
      title: `${focused?.label ?? 'study'}, ${isoDay(api)}`,
      template: 'courses/study',
      variables: { course: target.course },
      fields: {
        study_started: api.clock.now().toISOString(),
        ...(target.lesson !== undefined && { study_lesson: `[[${target.lesson}]]` }),
      },
    });
    return created.ok ? ok({ message: 'Started a timer' }) : created;
  },
};

/** Log study time against the focused course (amount + unit). */
const logAction: PanelAction = {
  key: 'l',
  label: 'log time',
  appliesTo: ['course'],
  surface: 'menu',
  inputs: [
    { name: 'amount', label: 'amount', type: 'number' },
    { name: 'unit', label: 'unit', type: 'enum', values: ['minutes', 'hours'], default: 'minutes' },
  ],
  async run(api, context) {
    const id = node(context)?.note?.id;
    if (id === undefined) return ok(null);
    const amount = Number(context.inputs?.amount);
    if (!Number.isFinite(amount) || amount < 0) return err(usage('amount must be a number ≥ 0'));
    const unit = String(context.inputs?.unit ?? 'minutes');
    const fields: Record<string, FieldValue> = {
      study_amount: amount,
      ...(unit !== 'minutes' && { study_unit: unit }),
    };
    const created = await api.capture({
      title: `Study, ${isoDay(api)}`,
      template: 'courses/study',
      variables: { course: id },
      fields,
    });
    return created.ok ? ok({ message: `Logged ${String(amount)} ${unit}` }) : created;
  },
};

/** Set the focused course's planned finish date. */
const setTargetAction: PanelAction = {
  key: 't',
  label: 'set target',
  appliesTo: ['course'],
  surface: 'menu',
  inputs: [{ name: 'date', label: 'target date (YYYY-MM-DD)', type: 'string' }],
  async run(api, context) {
    const id = node(context)?.note?.id;
    if (id === undefined) return ok(null);
    const parsed = parseIsoDate(String(context.inputs?.date ?? ''));
    if (!parsed.ok) return parsed;
    return api.setFields(id, { course_target: parsed.value });
  },
};

const isoDay = (api: PluginApi): string => api.clock.now().toISOString().slice(0, 10);

/** The course id a note of any owned type belongs to, for the note-side subtree. */
const courseIdOf = (
  entries: CoursesEntries,
  id: string,
  type: string | undefined,
): string | null => {
  if (type === 'study') return entries.studies.find((s) => s.id === id)?.course ?? null;
  if (type === 'chapter') return entries.chapters.find((c) => c.id === id)?.course ?? null;
  return courseOf(entries, id, type)?.course ?? null;
};

const entryRef = (n: { vault: string; path: string; id: string }): PanelEntryRef => ({
  vault: n.vault,
  path: n.path,
  id: n.id,
});

interface ListItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly note?: PanelEntryRef;
}

/** `detail`, with a `here` marker appended when the item is the note being viewed. */
const hereMark = (detail: string | undefined, here: boolean): string | undefined =>
  here ? [detail, 'here'].filter((part) => part !== undefined && part !== '').join(' · ') : detail;

const item = (
  id: string,
  title: string,
  note: PanelEntryRef,
  detail: string | undefined,
): ListItem => ({
  id,
  title,
  note,
  ...(detail !== undefined && { detail }),
});

/**
 * The focused note's course as a navigable list — a progress header, then the course's chapters
 * and lessons, the note being viewed marked `here`. Each item carries its note, so `Space p`
 * focuses the panel and `Enter` jumps between the course's lessons without leaving the course.
 */
const courseNavbar = (view: CourseView, hereId: string): PanelData => {
  const items: ListItem[] = [
    item(
      view.course.id,
      view.course.title,
      entryRef(view.course),
      hereMark(formatProgress(view.progress), view.course.id === hereId),
    ),
  ];
  for (const { chapter, lessons, done } of view.progress.chapters) {
    items.push(
      item(
        chapter.id,
        chapter.title,
        entryRef(chapter),
        hereMark(`${String(done)}/${String(lessons.length)}`, chapter.id === hereId),
      ),
    );
    for (const lesson of lessons) {
      items.push(
        item(
          lesson.id,
          `  ${LESSON_GLYPH[lesson.status]} ${lesson.title}`,
          entryRef(lesson),
          lesson.id === hereId ? 'here' : undefined,
        ),
      );
    }
  }
  return { kind: 'list', items };
};

/** The note-side panel: the focused note's course as a navigable list of its lessons. */
const loadEntryOutline = async (
  api: PluginApi,
  context: PanelContext,
): Promise<Result<PanelData, AppError>> => {
  const located = context.note;
  if (!located) return ok({ kind: 'list', items: [] });
  const entries = await load(api);
  if (!entries.ok) return entries;
  const courseId = courseIdOf(entries.value, located.note.id, located.note.type);
  const view = courseId === null ? undefined : courseView(entries.value, courseId);
  return ok(view ? courseNavbar(view, located.note.id) : { kind: 'list', items: [] });
};

export const PANELS: readonly PanelSpec[] = [
  {
    id: 'courses.home',
    title: 'Courses',
    placement: 'home',
    chord: 'C',
    load: loadTree,
    actions: [doneAction, stopAction, startAction, logAction, setTargetAction],
  },
  {
    id: 'courses.note',
    title: 'Course',
    placement: 'entry',
    appliesTo: 'owned',
    load: loadEntryOutline,
  },
];
