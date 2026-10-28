import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnose, type Finding } from '../../application/doctor/diagnose.js';
import { createPluginApi } from '../../application/plugin/api.js';
import type { PluginApi, PluginRegistry } from '../../application/plugin/plugin.js';
import { buildRegistry, enabledPlugin } from '../../application/plugin/registry.js';
import type { AppDeps } from '../../application/ports.js';
import { unwrap } from '../../domain/result.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { collect, type GoalsEntries } from './model.js';
import { goalsPlugin } from './plugin.js';
import { formatProgress, progressOf } from './progress.js';

/*
 * The fixtures under test/fixtures/goals are the contract (docs/goals.md §7): every file under
 * valid/ is a goal or session the plugin accepts, every file under invalid/ is one it rejects
 * with a stated reason. They go through the real frontmatter codec and index, not a fake parser.
 */

const fixturesDir = resolve(import.meta.dirname, '../../../test/fixtures/goals');

const readDir = async (sub: string): Promise<Map<string, string>> => {
  const names = (await readdir(join(fixturesDir, sub))).filter((n) => n.endsWith('.md')).sort();
  const files = new Map<string, string>();
  for (const name of names) {
    files.set(`${sub}/${name}`, await readFile(join(fixturesDir, sub, name), 'utf8'));
  }
  return files;
};

/** The default vault with goals enabled and every fixture in it, at a clock of 11:00Z. */
const setup = async (): Promise<{
  f: Fixture;
  deps: AppDeps;
  api: PluginApi;
  registry: PluginRegistry;
  valid: string[];
  invalid: string[];
}> => {
  const f = fixture({ plugins: { goals: {} } });
  const valid = await readDir('valid');
  const invalid = await readDir('invalid');
  for (const [path, source] of [...valid, ...invalid]) f.fs.files.set(path, source);
  const deps: AppDeps = { ...f.deps, clock: { now: () => new Date(Date.UTC(2026, 9, 27, 11)) } };
  const registry = unwrap(buildRegistry([goalsPlugin], f.scope));
  const enabled = enabledPlugin(registry, 'goals');
  if (!enabled) throw new Error('goals not enabled');
  return {
    f,
    deps,
    api: createPluginApi(deps, registry, enabled),
    registry,
    valid: [...valid.keys()],
    invalid: [...invalid.keys()],
  };
};

const collected = async (api: PluginApi): Promise<GoalsEntries> =>
  collect(unwrap(await api.list()));

const ofKind = (findings: readonly Finding[], kind: string) =>
  findings
    .filter((f) => f.kind === kind)
    .map((f) => ({ path: f.details.path, severity: f.severity, message: f.message }))
    .sort((a, b) => String(a.path).localeCompare(String(b.path)));

describe('goals contract fixtures', () => {
  it('accepts every valid fixture and rejects every invalid one with its reasons', async () => {
    const { api, valid, invalid } = await setup();
    const { goals, sessions, rejected } = await collected(api);
    const accepted = [...goals, ...sessions].map((n) => n.path).sort();
    expect(accepted).toEqual(valid);
    // A file without an id is unidentified for the core and invisible to the plugin (§7).
    expect(rejected.map((r) => r.path).sort()).toEqual(
      invalid.filter((path) => path !== 'invalid/session-unidentified.md'),
    );
    const problems = Object.fromEntries(rejected.map((r) => [r.path, r.problems.join('; ')]));
    expect(problems).toEqual({
      'invalid/goal-no-target.md': 'goal_target is required',
      'invalid/goal-string-target.md':
        'goal_target must be a number above zero, got "160"; goal_status must be one of active, achieved, dropped, got "paused"',
      'invalid/session-bare-id.md': 'session_goal must be a note link ("[[id]]")',
      'invalid/session-confirmed-no-amount.md': 'a confirmed session needs session_amount',
      'invalid/session-ended-first.md':
        'session_ended is before session_started; session_key must be 1-64 letters, digits, dots, dashes or underscores',
      'invalid/session-local-instant.md':
        'session_started: Expected an ISO 8601 instant with offset, like 2026-10-27T09:00:00+01:00',
      'invalid/session-no-day.md': 'a session needs its work day in dates:',
    });
  });

  it('reads the fields as the contract defines them', async () => {
    const { api } = await setup();
    const { goals, sessions } = await collected(api);
    expect(goals.find((g) => g.id === 'GOAL-CKA')).toMatchObject({
      title: 'Pass the CKA',
      target: 160,
      unit: { kind: 'time', name: 'hours' },
      due: '2027-03-31',
      outcome: 'CKA certification',
      status: 'active',
      openSession: 'SES-OPEN',
    });
    expect(goals.find((g) => g.id === 'GOAL-READ')).toMatchObject({
      unit: { kind: 'opaque', name: 'pages' },
      target: 300,
    });
    expect(sessions.find((s) => s.id === 'SES-TIMED')).toMatchObject({
      goal: 'GOAL-CKA',
      status: 'confirmed',
      amount: 50,
      unit: { kind: 'time', name: 'minutes' },
      day: '2026-10-22',
      started: { iso: '2026-10-22T18:00:00+02:00' },
      ended: { iso: '2026-10-22T18:55:00+02:00' },
    });
    expect(sessions.find((s) => s.id === 'SES-MINUTES')).toMatchObject({
      key: 'review-2026-10-21',
    });
  });

  it('derives progress from confirmed, compatible sessions of the same vault only', async () => {
    const { api, deps } = await setup();
    const { goals, sessions } = await collected(api);
    const cka = goals.find((g) => g.id === 'GOAL-CKA');
    if (!cka) throw new Error('no CKA goal');
    const p = progressOf(cka, sessions, deps.clock.now());
    expect(p.counted.map((s) => s.id).sort()).toEqual(['SES-MANUAL', 'SES-MINUTES', 'SES-TIMED']);
    expect(formatProgress(p)).toBe('4h20m / 160h');
    expect(p.percent).toBe(2);
    expect(p.excluded.map((e) => [e.session.id, e.reason])).toEqual([
      ['SES-PAGES-ON-CKA', "pages does not convert to the goal's hours"],
      ['SES-VOID', 'void'],
    ]);
    expect(p.open.map((s) => s.id)).toEqual(['SES-DETACHED', 'SES-OPEN']);
    expect(p.detached.map((s) => s.id)).toEqual(['SES-DETACHED']);
    expect(p.stale.map((s) => s.id)).toEqual(['SES-DETACHED']);

    const reading = goals.find((g) => g.id === 'GOAL-READ');
    if (!reading) throw new Error('no reading goal');
    expect(formatProgress(progressOf(reading, sessions, deps.clock.now()))).toBe(
      '40 pages / 300 pages',
    );
  });

  it('doctor reports rejected notes, excluded sessions and open-session problems', async () => {
    const { f, deps, registry } = await setup();
    const { findings } = unwrap(await diagnose(deps, f.scope, registry));

    expect(ofKind(findings, 'goals:invalid').map((x) => x.path)).toEqual([
      'invalid/goal-no-target.md',
      'invalid/goal-string-target.md',
      'invalid/session-bare-id.md',
      'invalid/session-confirmed-no-amount.md',
      'invalid/session-ended-first.md',
      'invalid/session-local-instant.md',
      'invalid/session-no-day.md',
    ]);
    expect(ofKind(findings, 'unidentified').map((x) => x.path)).toEqual([
      'invalid/session-unidentified.md',
    ]);
    expect(ofKind(findings, 'goals:excluded')).toEqual([
      {
        path: 'valid/session-mismatch.md',
        severity: 'warning',
        message: "Read the exam guide: pages does not convert to the goal's hours",
      },
      {
        path: 'valid/session-orphan.md',
        severity: 'warning',
        message: 'Session of a goal elsewhere: its goal is not in this scope',
      },
      { path: 'valid/session-void.md', severity: 'info', message: 'Logged twice: void' },
    ]);
    expect(ofKind(findings, 'goals:open')).toEqual([
      {
        path: 'valid/session-detached.md',
        severity: 'info',
        message: 'Forgotten timer: open for more than 12 hours; not registered on its goal',
      },
    ]);

    // The core's declared-field check names the offending key and the expected shape.
    const fields = findings.filter((x) => x.kind === 'field');
    expect(fields.map((x) => `${String(x.details.path)} ${String(x.details.field)}`)).toEqual([
      'invalid/goal-no-target.md goal_target',
      'invalid/goal-string-target.md goal_target',
      'invalid/goal-string-target.md goal_status',
      'invalid/session-bare-id.md session_goal',
    ]);
    expect(fields[3]?.message).toContain('must be a note link ("[[id]]")');
    expect(f.fs.writes).toEqual([]);
  });

  it('the built-in templates write a goal and a session whose link is a field reference', async () => {
    const { api, deps, f, registry } = await setup();
    const created = unwrap(
      await api.create({
        title: 'Lab 2',
        template: 'goals/session',
        variables: { session_goal: 'GOAL-CKA' },
      }),
    );
    expect(created.frontmatter).toMatchObject({
      type: 'session',
      session_goal: '[[GOAL-CKA]]',
      session_status: 'confirmed',
      dates: ['2026-10-27'],
    });
    const goal = unwrap(await api.create({ title: 'Learn Rust', template: 'goals/goal' }));
    expect(goal.frontmatter).toMatchObject({
      type: 'goal',
      goal_unit: 'hours',
      goal_status: 'active',
    });
    expect(goal.source).toContain('## Strategy');

    // Neither carries the numbers the commands will write; the contract says so and doctor shows it.
    const { findings } = unwrap(await diagnose(deps, f.scope, registry));
    const missing = findings
      .filter((x) => x.kind === 'field' && x.details.problem === 'missing')
      .map((x) => `${String(x.details.path)} ${String(x.details.field)}`);
    expect(missing).toContain(`${goal.path} goal_target`);
    expect(ofKind(findings, 'goals:invalid').map((x) => x.path)).toContain(created.path);
  });
});
