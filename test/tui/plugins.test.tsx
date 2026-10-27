import { afterEach, describe, expect, it } from 'vitest';
import type { NotePlugin } from '../../src/application/plugin/plugin.js';
import { ok } from '../../src/domain/result.js';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { buildTuiRegistry } from '../../src/interfaces/tui/tui.js';
import { todosPlugin } from '../../src/plugins/todos/plugin.js';
import { fixture } from '../fakes/index.js';
import { harness, KEYS, type Terminal } from './harness.js';

let term: Terminal | undefined;
afterEach(() => term?.unmount());

const todo = (id: string, title: string, extra = '') =>
  `---\nid: ${id}\ntitle: ${title}\ntype: todo\nstatus: open\n${extra}---\n\n# ${title}\n`;

describe('plugin panels', () => {
  it('opens the todos home panel by its key, opens a row, and runs its action', async () => {
    const h = harness(
      (f) => {
        f.fs.files.set('t1.md', todo('T1', 'Ship it', 'due: 2026-10-20\n'));
        f.fs.files.set('t2.md', todo('T2', 'Later', 'due: 2026-11-01\n'));
      },
      { plugins: [todosPlugin] },
    );
    term = h.start();
    const list = await term.waitFor('2 notes');
    expect(list).toContain('T todos');

    await term.press('T');
    const panel = await term.waitFor('d Mark done');
    expect(panel.indexOf('Ship it')).toBeLessThan(panel.indexOf('Later')); // due date order

    await term.press(KEYS.enter);
    const view = await term.waitFor('Ship it · monitor · T1 · todo');
    expect(view).toContain('Todo'); // the automatic note panel for owned types
    expect(view).toContain('status: open');
    expect(view).toContain('due: 2026-10-20');
    await term.press('u');
    await term.waitFor('d Mark done');

    await term.press('d');
    await term.waitFor('Updated t1.md');
    await term.waitFor((f) => !f.includes('Ship it'));
    expect(h.f.fs.files.get('t1.md')).toContain('status: done');
  });

  it('shows no plugin panel on a note the plugin does not own', async () => {
    const h = harness(
      (f) => {
        f.fs.files.set('plain.md', '---\nid: P\ntitle: Plain\n---\n\nbody\n');
      },
      { plugins: [todosPlugin] },
    );
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'P' })]);
    const frame = await term.waitFor('Plain · monitor · P');
    expect(frame).not.toContain('status:');
  });

  it('refuses to start when a plugin key clashes with a core key or a screen key', () => {
    const clashing = (key: string): NotePlugin => ({
      name: 'todos',
      description: 'x',
      types: ['todo'],
      fields: [],
      panels: [
        {
          id: 'todos.home',
          title: 'Todos',
          placement: 'home',
          key,
          load: () => Promise.resolve(ok({ kind: 'text', lines: [] })),
        },
      ],
    });
    const f = fixture({ plugins: { todos: {} } });
    const core = buildTuiRegistry(f.deps, f.scope, [clashing('c')]);
    expect(core).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    if (!core.ok)
      expect(core.error.message).toContain('core.calendar (core) and todos.home (todos)');
    const reserved = buildTuiRegistry(f.deps, f.scope, [clashing('n')]);
    if (!reserved.ok) expect(reserved.error.message).toContain('todos.home claims key "n"');
    expect(reserved.ok).toBe(false);
  });
});
