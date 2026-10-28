import { usage, type AppError } from '../../domain/errors.js';
import { summarize } from '../../domain/note/summary.js';
import { err, ok, type Result } from '../../domain/result.js';
import { isComposite } from '../../domain/scope/scope.js';
import { isoDate } from '../../application/notes/create-note.js';
import type {
  CheckResult,
  NotePlugin,
  PanelContext,
  PanelNoteRef,
  PluginApi,
  PluginCommand,
} from '../../application/plugin/plugin.js';
import {
  filterTodos,
  overdue,
  parseDue,
  sortTodos,
  STATUSES,
  todoOf,
  TODO_TYPE,
  type StatusFilter,
  type Todo,
} from './queries.js';
import { TASK_TEMPLATE } from './templates.js';

const NAME = 'todos';

const allTodos = async (api: PluginApi): Promise<Result<Todo[], AppError>> => {
  const entries = await api.list();
  if (!entries.ok) return entries;
  return ok(entries.value.flatMap((entry) => todoOf(entry) ?? []));
};

const today = (api: PluginApi): string => isoDate(api.clock.now());

const cells = (todo: Todo, composite: boolean): string[] => [
  ...(composite ? [todo.vault] : []),
  todo.id,
  todo.title,
  todo.status ?? '-',
  todo.due ?? '-',
  todo.priority === undefined ? '-' : String(todo.priority),
];

const header = (composite: boolean): string[] => [
  ...(composite ? ['vault'] : []),
  'id',
  'title',
  'status',
  'due',
  'priority',
];

const noteRef = (todo: Todo): PanelNoteRef => ({ vault: todo.vault, path: todo.path, id: todo.id });

const parseStatus = (raw: unknown): Result<StatusFilter, AppError> => {
  if (raw === undefined || raw === 'open') return ok('open');
  if (raw === 'done' || raw === 'all') return ok(raw);
  return err(usage(`--status must be open, done or all, not ${JSON.stringify(raw)}`));
};

const list: PluginCommand = {
  name: 'list',
  description: 'list todos (open ones by default)',
  options: [
    {
      flag: 'due',
      description: 'due today, on a date (YYYY-MM-DD) or in FROM..TO',
      value: 'string',
    },
    { flag: 'status', description: 'open (default) | done | all', value: 'string' },
  ],
  async run(api, input) {
    const status = parseStatus(input.options.status);
    if (!status.ok) return status;
    const dueOption = input.options.due;
    const due = typeof dueOption === 'string' ? parseDue(dueOption, today(api)) : undefined;
    if (due && !due.ok) return due;
    const todos = await allTodos(api);
    if (!todos.ok) return todos;
    const shown = sortTodos(
      filterTodos(todos.value, { status: status.value, ...(due && { due: due.value }) }),
    );
    const composite = isComposite(api.scope);
    return ok({
      kind: 'table',
      header: header(composite),
      rows: shown.map((todo) => cells(todo, composite)),
      json: { todos: shown },
      empty: 'No todos.',
    });
  },
};

const done: PluginCommand = {
  name: 'done',
  description: 'mark a todo as done',
  args: [{ name: 'query', description: 'todo to close: id, title or alias' }],
  async run(api, input) {
    const [query] = input.args;
    if (query === undefined) return err(usage('todos done needs a todo'));
    const outcome = await api.setFields(query, { status: 'done' }, { dryRun: input.dryRun });
    if (!outcome.ok) return outcome;
    return ok({ kind: 'mutation', outcome: outcome.value });
  },
};

const overdueCheck = async (api: PluginApi): Promise<Result<readonly CheckResult[], AppError>> => {
  const todos = await allTodos(api);
  if (!todos.ok) return todos;
  return ok(
    sortTodos(overdue(todos.value, today(api))).map((todo) => ({
      severity: 'info',
      vault: todo.vault,
      path: todo.path,
      message: `${todo.title} was due ${todo.due ?? ''}`,
      details: { id: todo.id, due: todo.due },
    })),
  );
};

const openTodosPanel = async (api: PluginApi) => {
  const todos = await allTodos(api);
  if (!todos.ok) return todos;
  const shown = sortTodos(filterTodos(todos.value, { status: 'open' }));
  const composite = isComposite(api.scope);
  return ok({
    kind: 'table' as const,
    header: header(composite),
    rows: shown.map((todo) => ({ cells: cells(todo, composite), note: noteRef(todo) })),
  });
};

const selectedNote = (context: PanelContext): PanelNoteRef | null => {
  const row = context.selection;
  if (typeof row !== 'object' || row === null || !('note' in row)) return null;
  const note = (row as { note?: PanelNoteRef }).note;
  return note?.id === undefined ? null : note;
};

export const todosPlugin: NotePlugin = {
  name: NAME,
  description: 'tasks with a status, a due date and a priority',
  types: [TODO_TYPE],
  fields: [
    { name: 'status', type: 'enum', values: STATUSES, required: true, description: 'open or done' },
    { name: 'due', type: 'date', description: 'when the task is due' },
    { name: 'priority', type: 'number', description: 'higher sorts first' },
  ],
  templates: { task: TASK_TEMPLATE },
  commands: [list, done],
  checks: [
    { kind: 'overdue', description: 'open todos whose due date has passed', run: overdueCheck },
  ],
  panels: [
    {
      id: 'todos.home',
      title: 'Todos',
      placement: 'home',
      chord: 'T',
      load: openTodosPanel,
      actions: [
        {
          key: 'd',
          label: 'Mark done',
          async run(api, context) {
            const note = selectedNote(context);
            if (note?.id === undefined) return ok(null);
            return api.setFields(note.id, { status: 'done' });
          },
        },
      ],
    },
    {
      id: 'todos.note',
      title: 'Todo',
      placement: 'note',
      appliesTo: 'owned',
      load: (_api, context) => {
        const located = context.note;
        const todo = located
          ? todoOf({ ...summarize(located.note), vault: located.vault.config.name })
          : null;
        return Promise.resolve(
          ok({
            kind: 'text',
            lines: todo
              ? [
                  `status: ${todo.status ?? '-'}`,
                  `due: ${todo.due ?? '-'}`,
                  `priority: ${todo.priority === undefined ? '-' : String(todo.priority)}`,
                ]
              : [],
          }),
        );
      },
    },
  ],
};
