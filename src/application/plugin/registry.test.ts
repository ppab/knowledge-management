import { describe, expect, it } from 'vitest';
import { validation } from '../../domain/errors.js';
import { err, ok, unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import type { NotePlugin, PanelSpec } from './plugin.js';
import { buildRegistry, enabledPlugin } from './registry.js';

const panel = (id: string, key: string, placement: PanelSpec['placement'] = 'home'): PanelSpec => ({
  id,
  title: id,
  placement,
  key,
  load: () => Promise.resolve(ok({ kind: 'text', lines: [] })),
});

const plugin = (name: string, overrides: Partial<NotePlugin> = {}): NotePlugin => ({
  name,
  description: name,
  types: [name.slice(0, -1)],
  fields: [],
  ...overrides,
});

const todos = plugin('todos', {
  fields: [{ name: 'status', type: 'enum', values: ['open', 'done'] }],
  panels: [panel('todos.home', 'T')],
  templates: { task: '---\nid: "{{id}}"\n---\n' },
  commands: [
    {
      name: 'list',
      description: 'l',
      run: () => Promise.resolve(ok({ kind: 'lines', lines: [], json: null })),
    },
  ],
  checks: [{ kind: 'overdue', description: 'o', run: () => Promise.resolve(ok([])) }],
});
const goals = plugin('goals', {
  fields: [{ name: 'status', type: 'enum', values: ['done', 'open'] }],
  panels: [panel('goals.home', 'G')],
});

describe('buildRegistry', () => {
  it('enables a plugin when any vault names it, and scopes it to those vaults', () => {
    const f = fixture({ plugins: { todos: {} } });
    f.addVault('/work', 'work');
    f.addVault('/other', 'other', { plugins: { goals: { x: 1 } } });
    const scope = f.scopeOf('/vault', '/work', { root: '/gone', reason: 'missing' }, '/other');

    const registry = unwrap(buildRegistry([todos, goals], scope));
    expect(registry.plugins.map((p) => p.name)).toEqual(['todos', 'goals']);
    expect(enabledPlugin(registry, 'todos')?.scope.members.map((m) => m.root)).toEqual([
      '/vault',
      '/gone',
    ]);
    expect(enabledPlugin(registry, 'goals')?.settings.get('/other')).toEqual({ x: 1 });
    expect(registry.ownerOf('todo')).toBe(todos);
    expect(registry.ownerOf('note')).toBeUndefined();
    expect(registry.fieldsFor('goal')).toEqual(goals.fields);
    expect(registry.panels('home').map((p) => p.id)).toEqual(['todos.home', 'goals.home']);
    expect(registry.commands().map((c) => `${c.plugin.name} ${c.command.name}`)).toEqual([
      'todos list',
    ]);
    expect(registry.checks().map((c) => c.check.kind)).toEqual(['overdue']);
    expect(Object.keys(registry.templates())).toEqual(['todos/task']);
  });

  it('is empty for a vault without plugins', () => {
    const f = fixture();
    const registry = unwrap(buildRegistry([todos, goals], f.scope));
    expect(registry.plugins).toEqual([]);
    expect(registry.templates()).toEqual({});
    expect(enabledPlugin(registry, 'todos')).toBeUndefined();
  });

  it('rejects an unknown plugin name in a vault config', () => {
    const f = fixture({ plugins: { expenses: {} } });
    expect(buildRegistry([todos], f.scope)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { plugin: 'expenses', available: ['todos'] } },
    });
  });

  it('runs the plugin settings validator per vault', () => {
    const strict = plugin('strict', {
      settings: (raw) =>
        typeof raw === 'object' && raw !== null && 'currency' in raw
          ? ok(raw)
          : err(validation('currency is required')),
    });
    const f = fixture({ plugins: { strict: { currency: 'EUR' } } });
    f.addVault('/work', 'work', { plugins: { strict: {} } });
    expect(buildRegistry([strict], f.scopeOf('/vault'))).toMatchObject({ ok: true });
    expect(buildRegistry([strict], f.scopeOf('/vault', '/work'))).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: expect.stringContaining('currency is required') as string,
        details: { plugin: 'strict', root: '/work' },
      },
    });
  });

  it('rejects two enabled plugins owning one type', () => {
    const f = fixture({ plugins: { todos: {}, tasks: {} } });
    const tasks = plugin('tasks', { types: ['todo'] });
    expect(buildRegistry([todos, tasks], f.scope)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { type: 'todo', plugins: ['todos', 'tasks'] } },
    });
    // Disabled plugins do not count.
    expect(buildRegistry([todos, tasks], fixture({ plugins: { todos: {} } }).scope)).toMatchObject({
      ok: true,
    });
  });

  it('rejects one field name declared with different types, but accepts the same declaration', () => {
    const f = fixture({ plugins: { todos: {}, goals: {} } });
    expect(buildRegistry([todos, goals], f.scope)).toMatchObject({ ok: true });
    const expenses = plugin('expenses', { fields: [{ name: 'status', type: 'string' }] });
    expect(
      buildRegistry([todos, expenses], fixture({ plugins: { todos: {}, expenses: {} } }).scope),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Field "status" is declared as enum by "todos" and as string by "expenses"',
      },
    });
  });

  it('rejects panel key and id collisions, naming both sides, including core panels', () => {
    const f = fixture({ plugins: { todos: {}, goals: {} } });
    const clash = plugin('goals', { panels: [panel('goals.home', 'T')] });
    expect(buildRegistry([todos, clash], f.scope)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Key "T" (home) is claimed by both todos.home (todos) and goals.home (goals)',
      },
    });
    expect(
      buildRegistry([todos], fixture({ plugins: { todos: {} } }).scope, {
        core: [panel('core.calendar', 'T')],
      }),
    ).toMatchObject({
      ok: false,
      error: { details: { key: 'T', panels: ['core.calendar', 'todos.home'] } },
    });
    // The same key on another placement is fine.
    const noteKey = plugin('goals', { panels: [panel('goals.note', 'T', 'note')] });
    expect(buildRegistry([todos, noteKey], f.scope)).toMatchObject({ ok: true });
    const sameId = plugin('goals', { panels: [panel('todos.home', 'G')] });
    expect(buildRegistry([todos, sameId], f.scope)).toMatchObject({
      ok: false,
      error: { details: { panel: 'todos.home', owners: ['todos', 'goals'] } },
    });
  });

  it('rejects a plugin registered twice', () => {
    expect(buildRegistry([todos, todos], fixture().scope)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { plugin: 'todos' } },
    });
  });
});
