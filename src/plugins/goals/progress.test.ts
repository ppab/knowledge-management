import { describe, expect, it } from 'vitest';
import { asNoteId } from '../../domain/note/note-id.js';
import { unwrap } from '../../domain/result.js';
import type { Goal, Session } from './model.js';
import {
  elapsedMinutes,
  exclusionReason,
  formatProgress,
  isStale,
  progressOf,
  sessionsOf,
} from './progress.js';
import { parseInstant, type Unit } from './units.js';

const hours: Unit = { kind: 'time', name: 'hours' };
const minutes: Unit = { kind: 'time', name: 'minutes' };
const pages: Unit = { kind: 'opaque', name: 'pages' };

const NOW = new Date(Date.UTC(2026, 9, 27, 11));

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  vault: 'v',
  path: 'goal.md',
  id: asNoteId('G'),
  title: 'Goal',
  version: '1',
  target: 160,
  unit: hours,
  status: 'active',
  ...overrides,
});

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  vault: 'v',
  path: `${id}.md`,
  id: asNoteId(id),
  title: id,
  version: '1',
  goal: asNoteId('G'),
  status: 'confirmed',
  day: '2026-10-20',
  ...overrides,
});

const at = (iso: string) => unwrap(parseInstant(iso));

describe('progress', () => {
  const sessions: Session[] = [
    session('manual', { amount: 2 }),
    session('minutes', { amount: 90, unit: minutes }),
    session('void', { status: 'void', amount: 3 }),
    session('pages', { amount: 40, unit: pages }),
    session('elsewhere', { amount: 5, vault: 'w' }),
    session('open', { status: 'open', started: at('2026-10-27T08:00:00Z') }),
    session('forgotten', { status: 'open', started: at('2026-10-26T08:00:00Z') }),
    session('other-goal', { amount: 99, goal: asNoteId('H') }),
  ];

  it('sums confirmed, compatible sessions of the goal in the goal unit', () => {
    const p = progressOf(goal({ openSession: asNoteId('open') }), sessions, NOW);
    expect(p.counted.map((s) => s.id)).toEqual(['manual', 'minutes']);
    expect(p.confirmed).toBe(3.5);
    expect(p.remaining).toBe(156.5);
    expect(p.percent).toBe(2);
    expect(p.reached).toBe(false);
    expect(formatProgress(p)).toBe('3h30m / 160h');
  });

  it('lists every excluded session with its reason', () => {
    const p = progressOf(goal(), sessions, NOW);
    expect(p.excluded.map((e) => [e.session.id, e.reason])).toEqual([
      ['void', 'void'],
      ['pages', "pages does not convert to the goal's hours"],
      ['elsewhere', `lives in vault "w", not the goal's vault "v"`],
    ]);
    expect(sessionsOf(goal(), sessions).map((s) => s.id)).not.toContain('other-goal');
  });

  it('separates open sessions into registered, detached and stale', () => {
    const registered = progressOf(goal({ openSession: asNoteId('open') }), sessions, NOW);
    expect(registered.open.map((s) => s.id)).toEqual(['open', 'forgotten']);
    expect(registered.detached.map((s) => s.id)).toEqual(['forgotten']);
    expect(registered.stale.map((s) => s.id)).toEqual(['forgotten']);
    const unregistered = progressOf(goal(), sessions, NOW);
    expect(unregistered.detached.map((s) => s.id)).toEqual(['open', 'forgotten']);
  });

  it('measures elapsed time and staleness from the start instant', () => {
    const open = session('open', { status: 'open', started: at('2026-10-27T08:00:00Z') });
    expect(elapsedMinutes(open, NOW)).toBe(180);
    expect(isStale(open, NOW)).toBe(false);
    expect(isStale(open, NOW, 2)).toBe(true);
    expect(elapsedMinutes(session('manual', { amount: 1 }), NOW)).toBeNull();
  });

  it('reaching the target caps the percent but keeps the overshoot and never changes status', () => {
    const p = progressOf(goal({ target: 3 }), [session('a', { amount: 4 })], NOW);
    expect(p.reached).toBe(true);
    expect(p.percent).toBe(100);
    expect(p.confirmed).toBe(4);
    expect(p.remaining).toBe(0);
    expect(p.goal.status).toBe('active');
  });

  it('counts minutes toward a goal in minutes and pages toward a goal in pages', () => {
    const inMinutes = progressOf(goal({ unit: minutes, target: 600 }), sessions, NOW);
    expect(inMinutes.confirmed).toBe(92); // 2 is in the goal's unit now: minutes
    expect(formatProgress(inMinutes)).toBe('1h32m / 10h');
    const reading = progressOf(
      goal({ id: asNoteId('R'), unit: pages, target: 300 }),
      [session('ch1', { goal: asNoteId('R'), amount: 40 })],
      NOW,
    );
    expect(formatProgress(reading)).toBe('40 pages / 300 pages');
    expect(reading.percent).toBe(13);
  });

  it('explains a confirmed session without an amount instead of counting zero', () => {
    expect(exclusionReason(goal(), session('x'))).toBe('has no session_amount');
  });
});
