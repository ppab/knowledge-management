import type { ScopedEntry } from '../../application/notes/list-notes.js';
import type { FieldSpec } from '../../application/plugin/plugin.js';
import { parseIsoDate, type IsoDate } from '../../domain/calendar/date-binding.js';
import type { FieldValue } from '../../domain/note/fields.js';
import type { NoteId } from '../../domain/note/note-id.js';
import { parseFieldReference } from '../../domain/reference/reference.js';
import { parseInstant, parseUnit, type Instant, type Unit } from './units.js';

/*
 * The Goals schema (docs/goals.md §2): two owned types, their declared fields, and strict
 * readers from index entries. Unlike todos, a goal or session with invalid metadata is not
 * read leniently: it is rejected with the reasons, so nothing half-understood reaches the
 * progress rule. Validation of what a file *says* is `doctor`'s; what counts is decided here.
 */

export const GOAL_TYPE = 'goal';
export const SESSION_TYPE = 'session';

export const GOAL_STATUSES = ['active', 'achieved', 'dropped'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const SESSION_STATUSES = ['open', 'confirmed', 'void'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** An open session older than this is flagged as stale; it is never closed automatically. */
export const STALE_OPEN_HOURS = 12;

/** `--key` values: path-safe, so a keyed session can live at a deterministic path. */
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const GOAL_FIELDS: readonly FieldSpec[] = [
  {
    name: 'goal_target',
    types: [GOAL_TYPE],
    type: 'number',
    required: true,
    description: 'the committed amount of work, in goal_unit',
  },
  {
    name: 'goal_unit',
    types: [GOAL_TYPE],
    type: 'string',
    required: true,
    description: 'hours, minutes, or a unit of your own; sessions must be compatible',
  },
  {
    name: 'goal_due',
    types: [GOAL_TYPE],
    type: 'date',
    description: 'the date the commitment runs to',
  },
  {
    name: 'goal_outcome',
    types: [GOAL_TYPE],
    type: 'string',
    description: 'the desired result; completing the work does not imply reaching it',
  },
  {
    name: 'goal_status',
    types: [GOAL_TYPE],
    type: 'enum',
    values: GOAL_STATUSES,
    required: true,
    description: 'active, achieved (outcome reached) or dropped',
  },
  {
    name: 'goal_open_session',
    types: [GOAL_TYPE],
    type: 'reference',
    description: 'the running timer session, "[[id]]"; set and cleared by the plugin',
  },
];

export const SESSION_FIELDS: readonly FieldSpec[] = [
  {
    name: 'session_goal',
    types: [SESSION_TYPE],
    type: 'reference',
    required: true,
    description: 'the goal this session counts toward, as "[[id]]"',
  },
  {
    name: 'session_status',
    types: [SESSION_TYPE],
    type: 'enum',
    values: SESSION_STATUSES,
    required: true,
    description: 'open (timer running), confirmed (counts) or void (kept, never counts)',
  },
  {
    name: 'session_amount',
    types: [SESSION_TYPE],
    type: 'number',
    description: 'the confirmed amount; required once confirmed, absent while open',
  },
  {
    name: 'session_unit',
    types: [SESSION_TYPE],
    type: 'string',
    description:
      "unit of session_amount when it differs from the goal's (hours and minutes convert)",
  },
  {
    name: 'session_started',
    types: [SESSION_TYPE],
    type: 'string',
    description: 'ISO 8601 instant with offset; the measured start of a timed session',
  },
  {
    name: 'session_ended',
    types: [SESSION_TYPE],
    type: 'string',
    description: 'ISO 8601 instant with offset; the measured end of a timed session',
  },
  {
    name: 'session_key',
    types: [SESSION_TYPE],
    type: 'string',
    description: 'client-chosen idempotency key of a manual log, unique per goal',
  },
];

export const FIELDS: readonly FieldSpec[] = [...GOAL_FIELDS, ...SESSION_FIELDS];

interface Identity {
  readonly vault: string;
  readonly path: string;
  readonly id: NoteId;
  readonly title: string;
  /** Content version at read time; what a mutation passes as `expectedVersion`. */
  readonly version: string;
}

export interface Goal extends Identity {
  readonly target: number;
  readonly unit: Unit;
  readonly due?: IsoDate;
  readonly outcome?: string;
  readonly status: GoalStatus;
  /** The session registered as running; see docs/goals.md §5. */
  readonly openSession?: NoteId;
}

export interface Session extends Identity {
  readonly goal: NoteId;
  readonly status: SessionStatus;
  /** Present once confirmed; in `unit` when given, else in the goal's unit. */
  readonly amount?: number;
  readonly unit?: Unit;
  /** The work day: the first `dates:` binding. */
  readonly day: IsoDate;
  readonly started?: Instant;
  readonly ended?: Instant;
  readonly key?: string;
}

/**
 * A goal or session note whose metadata does not satisfy the contract. Only identified notes
 * get here: an unidentified file has no `type` in its summary, so the core's `unidentified`
 * finding is the one that reports it.
 */
export interface Rejected extends Identity {
  readonly type: typeof GOAL_TYPE | typeof SESSION_TYPE;
  readonly problems: readonly string[];
}

export interface GoalsEntries {
  readonly goals: readonly Goal[];
  readonly sessions: readonly Session[];
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

const readGoalFields = (
  fields: Fields,
): { readonly goal: Omit<Goal, keyof Identity> | null; readonly problems: string[] } => {
  const problems: string[] = [];
  const target = fields.goal_target;
  if (!present(target)) problems.push('goal_target is required');
  else if (!finiteNumber(target) || target <= 0) {
    problems.push(`goal_target must be a number above zero, got ${JSON.stringify(target)}`);
  }
  const unit = parseUnit(fields.goal_unit);
  if (!unit) problems.push('goal_unit is required (hours, minutes, or a unit of your own)');
  const status = enumValue(GOAL_STATUSES, fields.goal_status);
  if (!status) {
    problems.push(
      `goal_status must be one of ${GOAL_STATUSES.join(', ')}, got ${JSON.stringify(fields.goal_status)}`,
    );
  }
  let due: IsoDate | undefined;
  if (present(fields.goal_due)) {
    const parsed = typeof fields.goal_due === 'string' ? parseIsoDate(fields.goal_due) : null;
    if (parsed?.ok) due = parsed.value;
    else
      problems.push(`goal_due must be a date (YYYY-MM-DD), got ${JSON.stringify(fields.goal_due)}`);
  }
  let outcome: string | undefined;
  if (present(fields.goal_outcome)) {
    if (typeof fields.goal_outcome === 'string') outcome = fields.goal_outcome;
    else problems.push('goal_outcome must be text');
  }
  let openSession: NoteId | undefined;
  if (present(fields.goal_open_session)) {
    const reference = parseFieldReference(fields.goal_open_session);
    if (reference) openSession = reference.target;
    else problems.push('goal_open_session must be a note link ("[[id]]")');
  }
  if (problems.length > 0 || !unit || !status || target === undefined || !finiteNumber(target)) {
    return { goal: null, problems };
  }
  return {
    goal: {
      target,
      unit,
      status,
      ...(due !== undefined && { due }),
      ...(outcome !== undefined && { outcome }),
      ...(openSession !== undefined && { openSession }),
    },
    problems,
  };
};

const readSessionFields = (
  fields: Fields,
  dates: readonly string[],
): { readonly session: Omit<Session, keyof Identity> | null; readonly problems: string[] } => {
  const problems: string[] = [];
  const goal = parseFieldReference(fields.session_goal);
  if (!goal) problems.push('session_goal must be a note link ("[[id]]")');
  const status = enumValue(SESSION_STATUSES, fields.session_status);
  if (!status) {
    problems.push(
      `session_status must be one of ${SESSION_STATUSES.join(', ')}, got ${JSON.stringify(fields.session_status)}`,
    );
  }
  const day = dates[0];
  if (day === undefined) problems.push('a session needs its work day in dates:');

  let amount: number | undefined;
  if (present(fields.session_amount)) {
    if (finiteNumber(fields.session_amount) && fields.session_amount >= 0) {
      amount = fields.session_amount;
    } else {
      problems.push(
        `session_amount must be a number of zero or more, got ${JSON.stringify(fields.session_amount)}`,
      );
    }
  }
  if (status === 'confirmed' && amount === undefined && !present(fields.session_amount)) {
    problems.push('a confirmed session needs session_amount');
  }
  let unit: Unit | undefined;
  if (present(fields.session_unit)) {
    const parsed = parseUnit(fields.session_unit);
    if (parsed) unit = parsed;
    else problems.push('session_unit must be a unit name');
  }
  let started: Instant | undefined;
  if (present(fields.session_started)) {
    const parsed = parseInstant(fields.session_started);
    if (parsed.ok) started = parsed.value;
    else problems.push(`session_started: ${parsed.error.message}`);
  }
  let ended: Instant | undefined;
  if (present(fields.session_ended)) {
    const parsed = parseInstant(fields.session_ended);
    if (parsed.ok) ended = parsed.value;
    else problems.push(`session_ended: ${parsed.error.message}`);
  }
  if (status === 'open' && !present(fields.session_started)) {
    problems.push('an open session needs session_started');
  }
  if (ended && !started) problems.push('session_ended needs session_started');
  if (ended && started && ended.epochMs < started.epochMs) {
    problems.push('session_ended is before session_started');
  }
  let key: string | undefined;
  if (present(fields.session_key)) {
    if (typeof fields.session_key === 'string' && KEY_PATTERN.test(fields.session_key)) {
      key = fields.session_key;
    } else {
      problems.push('session_key must be 1-64 letters, digits, dots, dashes or underscores');
    }
  }
  if (problems.length > 0 || !goal || !status || day === undefined) {
    return { session: null, problems };
  }
  return {
    session: {
      goal: goal.target,
      status,
      day,
      ...(amount !== undefined && { amount }),
      ...(unit !== undefined && { unit }),
      ...(started !== undefined && { started }),
      ...(ended !== undefined && { ended }),
      ...(key !== undefined && { key }),
    },
    problems,
  };
};

/** Splits a scope's entries into valid goals, valid sessions and rejected notes of either type. */
export const collect = (entries: readonly ScopedEntry[]): GoalsEntries => {
  const goals: Goal[] = [];
  const sessions: Session[] = [];
  const rejected: Rejected[] = [];
  for (const entry of entries) {
    if (entry.type !== GOAL_TYPE && entry.type !== SESSION_TYPE) continue;
    const type = entry.type;
    if (entry.kind !== 'note') continue;
    const identity: Identity = {
      vault: entry.vault,
      path: entry.path,
      id: entry.id,
      title: entry.title,
      version: entry.version,
    };
    if (type === GOAL_TYPE) {
      const read = readGoalFields(entry.fields);
      if (read.goal) goals.push({ ...identity, ...read.goal });
      else rejected.push({ ...identity, type, problems: read.problems });
    } else {
      const read = readSessionFields(entry.fields, entry.dates);
      if (read.session) sessions.push({ ...identity, ...read.session });
      else rejected.push({ ...identity, type, problems: read.problems });
    }
  }
  return { goals, sessions, rejected };
};
