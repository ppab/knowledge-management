import { describe, expect, it } from 'vitest';
import { createPluginApi } from '../../application/plugin/api.js';
import type { PluginApi, PluginCommand } from '../../application/plugin/plugin.js';
import { buildRegistry, enabledPlugin } from '../../application/plugin/registry.js';
import { diagnose } from '../../application/doctor/diagnose.js';
import { asNoteId } from '../../domain/note/note-id.js';
import { unwrap } from '../../domain/result.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';

const X = asNoteId('X');
import { todosPlugin } from './plugin.js';
import { filterTodos, overdue, parseDue, sortTodos, todoOf, type Todo } from './queries.js';

const note = (id: string, title: string, fields = '') =>
  `---\nid: ${id}\ntitle: ${title}\ntype: todo\n${fields}---\n`;

/** The default vault with todos enabled, two open todos, one done, one undated. */
const setup = (): { f: Fixture; api: PluginApi } => {
  const f = fixture({ plugins: { todos: {} } });
  f.fs.files.set('a.md', note('A', 'Write tests', 'status: open\ndue: 2026-10-27\npriority: 2\n'));
  f.fs.files.set('b.md', note('B', 'Ship', 'status: open\ndue: 2026-10-20\n'));
  f.fs.files.set('c.md', note('C', 'Done already', 'status: done\ndue: 2026-10-27\n'));
  f.fs.files.set('d.md', note('D', 'Someday', 'status: open\n'));
  f.fs.files.set('n.md', '---\nid: N\ntitle: Not a todo\nstatus: open\n---\n');
  const registry = unwrap(buildRegistry([todosPlugin], f.scope));
  const enabled = enabledPlugin(registry, 'todos');
  if (!enabled) throw new Error('todos not enabled');
  return { f, api: createPluginApi(f.deps, registry, enabled) };
};

const command = (name: string): PluginCommand => {
  const found = todosPlugin.commands?.find((c) => c.name === name);
  if (!found) throw new Error(`no command ${name}`);
  return found;
};

describe('todos queries', () => {
  const todos: Todo[] = [
    { vault: 'v', path: 'a', id: 'A', title: 'b-title', status: 'open', due: '2026-10-27' },
    {
      vault: 'v',
      path: 'b',
      id: 'B',
      title: 'a-title',
      status: 'open',
      due: '2026-10-27',
      priority: 1,
    },
    { vault: 'v', path: 'c', id: 'C', title: 'late', status: 'open', due: '2026-10-01' },
    { vault: 'v', path: 'd', id: 'D', title: 'undated', status: 'later' },
    { vault: 'v', path: 'e', id: 'E', title: 'done', status: 'done', due: '2026-10-01' },
  ];

  it('sorts by due date, then priority, then title, undated last', () => {
    expect(sortTodos(todos).map((t) => t.id)).toEqual(['E', 'C', 'B', 'A', 'D']);
  });

  it('filters by status (anything but done is open) and due range', () => {
    expect(filterTodos(todos, {}).map((t) => t.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(filterTodos(todos, { status: 'done' }).map((t) => t.id)).toEqual(['E']);
    expect(filterTodos(todos, { status: 'all' })).toHaveLength(5);
    expect(
      filterTodos(todos, { due: { from: '2026-10-27', to: '2026-10-27' } }).map((t) => t.id),
    ).toEqual(['A', 'B']);
    expect(overdue(todos, '2026-10-27').map((t) => t.id)).toEqual(['C']);
  });

  it('reads todos leniently from index entries', () => {
    const base = {
      kind: 'note' as const,
      vault: 'v',
      path: 'x.md',
      title: 'X',
      aliases: [],
      dates: [],
      tags: [],
      visibility: 'private' as const,
      version: '',
      issues: [],
    };
    expect(
      todoOf({ ...base, id: X, type: 'todo', fields: { due: 'soon', priority: 'high' } }),
    ).toEqual({ vault: 'v', path: 'x.md', id: 'X', title: 'X' });
    expect(todoOf({ ...base, id: X, type: 'note', fields: {} })).toBeNull();
    expect(todoOf({ ...base, kind: 'unidentified', type: 'todo', fields: {} })).toBeNull();
  });

  it('parses --due as today, a date or a range', () => {
    expect(unwrap(parseDue('today', '2026-10-27'))).toEqual({
      from: '2026-10-27',
      to: '2026-10-27',
    });
    expect(unwrap(parseDue('2026-10-01..2026-10-31', 'x'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(parseDue('tomorrow', 'x')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('todos commands', () => {
  it('lists open todos by default, sorted, as a table and as JSON', async () => {
    const { api } = setup();
    const output = unwrap(await command('list').run(api, { args: [], options: {}, dryRun: false }));
    expect(output).toMatchObject({
      kind: 'table',
      header: ['id', 'title', 'status', 'due', 'priority'],
      rows: [
        ['B', 'Ship', 'open', '2026-10-20', '-'],
        ['A', 'Write tests', 'open', '2026-10-27', '2'],
        ['D', 'Someday', 'open', '-', '-'],
      ],
    });
    const json = (output as { json: { todos: Todo[] } }).json;
    expect(json.todos.map((t) => t.id)).toEqual(['B', 'A', 'D']);
  });

  it('filters with --due today and --status', async () => {
    const { api } = setup();
    const today = unwrap(
      await command('list').run(api, { args: [], options: { due: 'today' }, dryRun: false }),
    );
    expect(today).toMatchObject({ rows: [['A', 'Write tests', 'open', '2026-10-27', '2']] });
    const done = unwrap(
      await command('list').run(api, { args: [], options: { status: 'done' }, dryRun: false }),
    );
    expect(done).toMatchObject({ rows: [['C', 'Done already', 'done', '2026-10-27', '-']] });
    expect(
      await command('list').run(api, { args: [], options: { status: 'later' }, dryRun: false }),
    ).toMatchObject({ ok: false, error: { code: 'USAGE' } });
    expect(
      await command('list').run(api, { args: [], options: { due: 'soon' }, dryRun: false }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('marks a todo done through the mutation path, dry-run included', async () => {
    const { f, api } = setup();
    const dry = unwrap(
      await command('done').run(api, { args: ['Ship'], options: {}, dryRun: true }),
    );
    expect(dry).toMatchObject({ kind: 'mutation', outcome: { written: false, dryRun: true } });
    expect(f.fs.writes).toEqual([]);
    const real = unwrap(
      await command('done').run(api, { args: ['Ship'], options: {}, dryRun: false }),
    );
    expect(real).toMatchObject({ kind: 'mutation', outcome: { path: 'b.md', written: true } });
    expect(f.fs.files.get('b.md')).toContain('status: done\n');
    expect(
      await command('done').run(api, { args: ['nope'], options: {}, dryRun: false }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('creates a todo from the built-in task template', async () => {
    const { f, api } = setup();
    const created = unwrap(await api.create({ title: 'New task', template: 'todos/task' }));
    expect(created.type).toBe('todo');
    expect(f.fs.files.get(created.path)).toContain('type: todo\nstatus: open\n');
    // A vault template of the same name wins.
    f.templates.set('todos/task', '---\nid: "{{id}}"\ntype: todo\nstatus: open\nowner: me\n---\n');
    const own = unwrap(await api.create({ title: 'Mine', template: 'todos/task' }));
    expect(f.fs.files.get(own.path)).toContain('owner: me');
  });
});

describe('todos panels and checks', () => {
  it('loads the home panel with openable rows and closes a selected row', async () => {
    const { f, api } = setup();
    const home = todosPlugin.panels?.find((p) => p.id === 'todos.home');
    if (!home) throw new Error('no home panel');
    const data = unwrap(await home.load(api, {}));
    expect(data).toMatchObject({
      kind: 'table',
      rows: [
        {
          cells: ['B', 'Ship', 'open', '2026-10-20', '-'],
          note: { vault: 'monitor', path: 'b.md', id: 'B' },
        },
        expect.objectContaining({ note: { vault: 'monitor', path: 'a.md', id: 'A' } }),
        expect.objectContaining({ note: { vault: 'monitor', path: 'd.md', id: 'D' } }),
      ],
    });
    const [action] = home.actions ?? [];
    if (!action) throw new Error('no action');
    const row = data.kind === 'table' ? data.rows[0] : undefined;
    expect(unwrap(await action.run(api, { selection: row }))).toMatchObject({ written: true });
    expect(f.fs.files.get('b.md')).toContain('status: done');
    expect(unwrap(await action.run(api, {}))).toBeNull();
  });

  it('shows a todo note as text and nothing for other notes', async () => {
    const { api } = setup();
    const panel = todosPlugin.panels?.find((p) => p.id === 'todos.note');
    if (!panel) throw new Error('no note panel');
    const located = unwrap(await api.read('A'));
    expect(unwrap(await panel.load(api, { note: located }))).toEqual({
      kind: 'text',
      lines: ['status: open', 'due: 2026-10-27', 'priority: 2'],
    });
    expect(unwrap(await panel.load(api, { note: unwrap(await api.read('N')) }))).toEqual({
      kind: 'text',
      lines: [],
    });
  });

  it('reports overdue todos through doctor, namespaced, as info', async () => {
    const { f } = setup();
    const registry = unwrap(buildRegistry([todosPlugin], f.scope));
    const diagnosis = unwrap(await diagnose(f.deps, f.scope, registry));
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.findings.map((x) => [x.kind, x.severity, x.details.path])).toEqual([
      ['todos:overdue', 'info', 'b.md'],
    ]);
    expect(diagnosis.findings[0]?.message).toBe('Ship was due 2026-10-20');
  });
});
