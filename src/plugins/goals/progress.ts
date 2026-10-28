import { STALE_OPEN_HOURS, type Goal, type Session } from './model.js';
import { convert, formatAmount, minutesBetween, type Unit } from './units.js';

/*
 * The progress rule (docs/goals.md §4): confirmed amounts of the goal's own sessions, each
 * expressed in the goal's unit, summed. Everything that does not count says why, so a panel
 * or `doctor` can show it next to the number instead of hiding it.
 */

export interface Exclusion {
  readonly session: Session;
  readonly reason: string;
}

export interface Progress {
  readonly goal: Goal;
  /** Sum of counted amounts, in the goal's unit. */
  readonly confirmed: number;
  readonly target: number;
  /** `target - confirmed`, never below zero. */
  readonly remaining: number;
  /** Whole percent of the target, capped at 100 for bars; `confirmed` keeps the overshoot. */
  readonly percent: number;
  readonly reached: boolean;
  readonly counted: readonly Session[];
  readonly excluded: readonly Exclusion[];
  /** Open sessions of the goal, registered or not. */
  readonly open: readonly Session[];
  /** Open sessions older than `STALE_OPEN_HOURS`. */
  readonly stale: readonly Session[];
  /** Open sessions the goal does not name in `goal_open_session` (see docs/goals.md §5). */
  readonly detached: readonly Session[];
}

export const sessionsOf = (goal: Goal, sessions: readonly Session[]): Session[] =>
  sessions.filter((s) => s.goal === goal.id);

/** Minutes since an open session started; `null` for a session without a start. */
export const elapsedMinutes = (session: Session, now: Date): number | null =>
  session.started ? minutesBetween(session.started, now) : null;

export const isStale = (session: Session, now: Date, hours = STALE_OPEN_HOURS): boolean => {
  const elapsed = elapsedMinutes(session, now);
  return elapsed !== null && elapsed > hours * 60;
};

/** Why a session of `goal` does not count, or `null` when it does. */
export const exclusionReason = (goal: Goal, session: Session): string | null => {
  if (session.vault !== goal.vault) {
    return `lives in vault "${session.vault}", not the goal's vault "${goal.vault}"`;
  }
  if (session.status === 'void') return 'void';
  if (session.status === 'open') return 'still open';
  if (session.amount === undefined) return 'has no session_amount';
  const unit: Unit = session.unit ?? goal.unit;
  if (convert({ value: session.amount, unit }, goal.unit) === null) {
    return `${unit.name} does not convert to the goal's ${goal.unit.name}`;
  }
  return null;
};

export const progressOf = (goal: Goal, sessions: readonly Session[], now: Date): Progress => {
  const counted: Session[] = [];
  const excluded: Exclusion[] = [];
  const open: Session[] = [];
  let confirmed = 0;
  for (const session of sessionsOf(goal, sessions)) {
    if (session.status === 'open' && session.vault === goal.vault) open.push(session);
    const reason = exclusionReason(goal, session);
    if (reason !== null) {
      // Open sessions are listed as open, not as excluded; they are not a problem.
      if (reason !== 'still open') excluded.push({ session, reason });
      continue;
    }
    const unit = session.unit ?? goal.unit;
    confirmed += convert({ value: session.amount ?? 0, unit }, goal.unit) ?? 0;
    counted.push(session);
  }
  const remaining = Math.max(0, goal.target - confirmed);
  return {
    goal,
    confirmed,
    target: goal.target,
    remaining,
    percent: Math.min(100, Math.floor((confirmed / goal.target) * 100)),
    reached: confirmed >= goal.target,
    counted,
    excluded,
    open,
    stale: open.filter((s) => isStale(s, now)),
    detached: open.filter((s) => s.id !== goal.openSession),
  };
};

/** `3h30m / 160h`, or `40 pages / 300 pages`. */
export const formatProgress = (progress: Progress): string =>
  `${formatAmount(progress.confirmed, progress.goal.unit)} / ${formatAmount(progress.target, progress.goal.unit)}`;
