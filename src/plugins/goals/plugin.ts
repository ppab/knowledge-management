import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type {
  CheckResult,
  NotePlugin,
  PluginApi,
  PluginCheck,
} from '../../application/plugin/plugin.js';
import { collect, FIELDS, GOAL_TYPE, SESSION_TYPE, type GoalsEntries } from './model.js';
import { exclusionReason, isStale, sessionsOf } from './progress.js';
import { GOAL_TEMPLATE, SESSION_TEMPLATE } from './templates.js';

/*
 * Goals: a committed amount of work toward a desired outcome, with progress derived from
 * confirmed work sessions (docs/goals.md). Delivery A declares the schema, the templates and
 * the doctor checks; commands, panels and the timer follow in B–D.
 */

const NAME = 'goals';

const load = async (api: PluginApi): Promise<Result<GoalsEntries, AppError>> => {
  const entries = await api.list();
  return entries.ok ? ok(collect(entries.value)) : entries;
};

/** Goal or session notes whose metadata the contract rejects; `doctor`'s field check says which key. */
const invalidCheck: PluginCheck = {
  kind: 'invalid',
  description: 'goal or session notes whose metadata does not satisfy the contract',
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

/** Valid sessions that do not count toward their goal, with the reason. */
const excludedCheck: PluginCheck = {
  kind: 'excluded',
  description:
    'sessions that do not count toward their goal (void, unit mismatch, wrong vault, missing goal)',
  async run(api) {
    const loaded = await load(api);
    if (!loaded.ok) return loaded;
    const { goals, sessions } = loaded.value;
    const results: CheckResult[] = [];
    for (const session of sessions) {
      if (session.status === 'open') continue;
      const goal = goals.find((g) => g.id === session.goal);
      const reason = goal ? exclusionReason(goal, session) : 'its goal is not in this scope';
      if (reason === null) continue;
      results.push({
        severity: reason === 'void' ? 'info' : 'warning',
        vault: session.vault,
        path: session.path,
        message: `${session.title}: ${reason}`,
        details: { id: session.id, goal: session.goal, reason },
      });
    }
    return ok(results);
  },
};

/** Open sessions that are stale or detached from their goal (docs/goals.md §5). */
const openCheck: PluginCheck = {
  kind: 'open',
  description: `open sessions older than 12 hours, or not registered on their goal`,
  async run(api) {
    const loaded = await load(api);
    if (!loaded.ok) return loaded;
    const { goals, sessions } = loaded.value;
    const now = api.clock.now();
    const results: CheckResult[] = [];
    for (const session of sessions) {
      if (session.status !== 'open') continue;
      const goal = goals.find((g) => g.id === session.goal);
      const reasons: string[] = [];
      if (isStale(session, now)) reasons.push('open for more than 12 hours');
      if (!goal) reasons.push('its goal is not in this scope');
      else if (goal.openSession !== session.id) reasons.push('not registered on its goal');
      if (reasons.length === 0) continue;
      results.push({
        severity: 'info',
        vault: session.vault,
        path: session.path,
        message: `${session.title}: ${reasons.join('; ')}`,
        details: { id: session.id, goal: session.goal, reasons },
      });
    }
    // A goal that names a session which is not open any more points at nothing useful.
    for (const goal of goals) {
      if (goal.openSession === undefined) continue;
      const named = sessionsOf(goal, sessions).find((s) => s.id === goal.openSession);
      if (named?.status === 'open') continue;
      results.push({
        severity: 'warning',
        vault: goal.vault,
        path: goal.path,
        message: `${goal.title}: goal_open_session names ${named ? `a ${named.status} session` : 'no session in this scope'}`,
        details: { id: goal.id, openSession: goal.openSession },
      });
    }
    return ok(results);
  },
};

export const goalsPlugin: NotePlugin = {
  name: NAME,
  description: 'committed work toward an outcome, measured from confirmed sessions',
  types: [GOAL_TYPE, SESSION_TYPE],
  fields: FIELDS,
  templates: { goal: GOAL_TEMPLATE, session: SESSION_TEMPLATE },
  checks: [invalidCheck, excludedCheck, openCheck],
};
