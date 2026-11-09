# Courses commands and UI — deliveries B–D

Status: draft implementation plan (2026-11-08). Companions: the [courses contract](../courses.md)
(delivery A — schema, templates, progress, doctor), [goals.md](../goals.md) §10 (the delivery
model this mirrors), [plugins.md](../plugins.md) (the plugin contract), ADR
[0003](../decisions/0003-workspace-layout-and-leader-key.md) (leader key / panel chords),
ADR [0004](../decisions/0004-inkjs-ui-adoption.md) (TUI components).

## Context

`docs/courses.md` fixes the **schema** of the `courses` plugin — four note types (`course`,
`chapter`, `lesson`, `study`), their `FieldSpec`s, templates, derived progress and two doctor
checks — and defers every verb to "later deliveries": the commands (`courses outline`,
`courses done <lesson>`, `courses log <course> <amount>`, timer `start`/`stop`) and the TUI
panels (a home `Courses` panel with progress bars, a note panel showing a course's tree). This
document plans those deliveries. **Delivery A has landed** (commit `0bafda3`, 2026-11-08):
`src/plugins/courses/` ships `model`/`progress`/`units`/`templates`, the `invalid` and `orphan`
doctor checks, and registration in `index.ts`; `plugin.ts` carries no `commands` and no `panels`
yet ("commands and panels follow"). `study_started`/`study_ended` exist as the reserved timer
scaffolding, and there is **no `study_key`** field. B–D build on A's pure functions with no change
to the schema except where a section says so (decision 2).

The work parallels the `goals` plugin almost exactly (`goals` is also schema-only today), so each
delivery below reuses a pattern already written for `todos`/`goals` and names the file it copies:

- **Commands** follow `todos/plugin.ts` — a `PluginCommand` is pure data plus a `run(api, input)`
  returning a `CommandOutput` (`table | lines | mutation`). Reads go through `api.list()`;
  mutations through `api.setFields` / `api.create`, both of which already route through the
  mutation path with `dryRun`.
- **Panels** follow `todos`' `panels` shape (`PanelData` + `PanelAction`s), but the courses view is
  a **dedicated tree screen** (like the calendar), so delivery D adds a `tree` kind to `PanelData`
  rather than reusing `list | table | text`. See delivery D.

### Decisions (settled 2026-11-08)

Resolved in conversation; the plan below reflects these, not the contract's silence.

1. **Command breadth — `new`/`show` included.** B ships `courses new` and `courses show` alongside
   `outline`/`done`/`log`. `new` earns its place over raw `create --template` because a course has a
   parent chain: `new` resolves the parent **query** (`--course`, `--chapter`) and assigns the next
   `*_order`, which `create` cannot. `list` stays folded into `outline`.
2. **No `study_key`; the timer is the primary path — dropped.** Time is recorded by pressing
   start/stop (the timer, delivery C), which cannot double-log — one open study at a time, closed by
   `stop`. `courses log <amount>` stays only as an after-the-fact escape hatch for time spent away
   from the tool. No idempotency key, no `duplicate-key` check.
3. **`stop` scans for the open study — no pointer field.** A course names nothing; `stop` (and the
   `courses:open` doctor check) find the single open study in scope (has `study_started`, no
   `study_ended`/`study_amount`) and error naming both if two are open.
4. **Progress as text now, `ProgressBar` later.** Panels render `3/24 lessons · 6h30m` as text; the
   `ProgressBar` cell is the same core extension `goals` delivery D calls for, added with it, not
   before.
5. **Course start/finish are derived; `course_target` is the one stored plan.** A course's _started_
   = the date of its first study session (or first lesson marked done); _finished_ = when
   `course_status` → `completed` or every lesson is `done` — both derived, never stored, per the
   plugin's derive-don't-store rule (contract §2). The only stored lifecycle field is
   **`course_target`** (an optional planned finish date, like `goal_due`) — a schema addendum to
   delivery A (see below).
6. **UI model — a dedicated tree screen, not a home table.** `NoteList` stays the flat index of all
   notes. The courses view is its **own designed screen**, opened by `Space → C`, the way the
   calendar opens its own screen instead of a generic panel (`chords.tsx:24`). Because a plugin may
   not ship an Ink screen (the layer boundary), the designed view is delivered as a new **interactive
   `tree` kind of `PanelData`** that the core renders: collapsible course → chapter → lesson, with
   inline action spans. A note's verbs depend on its type and are offered two ways on that screen —
   the **leader (`Space`) menu scoped to the focused node's type** (note-level verbs: `log`, `start`,
   `set target`, `stop`) and **inline action links** on the node under the cursor (per-child verbs:
   `[done]`/`[start]`, reusing the reference cursor machinery). The note panel inside a single note
   is a focused subtree of the same renderer. See delivery D.

### Schema addendum to delivery A — `course_target`

One optional `FieldSpec` on `COURSE_TYPE`, added to `model.ts`/`plugin.ts` as a small follow-up
commit to `0bafda3` (it is schema, not a command):

```ts
{ name: 'course_target', types: [COURSE_TYPE], type: 'date',
  description: 'a planned finish date; progress is still derived, this is only the plan' }
```

`doctor`'s generic field check validates it; `progressOf` may report "behind/ahead of target" by
comparing the derived pace to `course_target`, but nothing is enforced. No other field changes.

## Delivery B — read and mutate commands (CLI)

`src/plugins/courses/commands.ts` (new), wired into `coursesPlugin.commands`. Pure helpers for the
tree go in a new `outline.ts`; progress reuses delivery A's `progress.ts`.

### `courses outline [course]`

The headline read: the course → chapter → lesson tree with derived progress. With no argument,
every course in scope; with a `course` query (id, title or alias, resolved by `api.read`), just
that one.

- **Build.** `api.list()` → delivery A's `collect()` → for each course, order chapters by
  `chapter_order`, their lessons by `lesson_order`, compute `progressOf` (lessons done/total,
  study minutes). Invalid notes are excluded and surfaced only by `doctor`, per contract §2.
- **Output** (`kind: 'lines'` for the tree, `json` carrying the structured outline):
  ```
  CS50  ·  3/24 lessons · 6h30m  ·  active
    0  Week 0 — Scratch        1/3
       ✓ Functions             done
       · Variables             in-progress
       ○ Loops                 todo
    1  Week 1 — C              2/5
       …
  ```
  Status glyphs: `✓` done, `·` in-progress, `○` todo. A composite scope prefixes the course line
  with its vault (the `isComposite(api.scope)` idiom from `todos`).
- **Options.** `--status <todo|in-progress|done>` filters lessons; `--json` is the harness-wide
  flag (handled by the CLI, not the command).

### `courses done <lesson>`

Mirror of `todos done`: resolve the lesson query, `api.setFields(query, { lesson_status: 'done' },
{ dryRun })`, return `{ kind: 'mutation', outcome }`. Rejects a non-lesson target with a `usage`
error before writing.

### `courses log <course> <amount>`

Record time against a course by **creating a `study` note** (contract §1.4).

- **Args.** `course` (query, required), `amount` (number, required).
- **Options.** `--lesson <query>` (sets `study_lesson`; `study_course` is always stored directly
  so per-course totals stay a single filter), `--unit <minutes|hours>` (default `minutes`),
  `--on <YYYY-MM-DD>` (the work day → first `dates:` entry; default today via `api.clock`),
  `--title <text>` (default `"<course title>, <date>"`).
- **Write.** `api.create` with template `courses/study` and the reference variables, then set the
  numeric `study_amount` as a real number (a template placeholder always renders as a YAML string,
  the same constraint `goals`/`templates.ts` documents). Reuses the "typed create" core extension
  that `goals` delivery B introduces (create-as-plan then write typed fields under `dryRun`); if
  that has not landed, B does `create` + `setFields` in sequence.
- **No idempotency key** (decision 2): `log` is an occasional after-the-fact entry, and the timer
  (delivery C) — not `log` — is the primary path, so there is nothing to double-log automatically.

### `courses new <type> <title>` and `courses show <course>`

`new` wraps `api.create` with the matching template (`courses/course|chapter|lesson`), taking the
parent as `--course` / `--chapter`. `show` prints one course's outline plus its study log and
excluded/invalid notes — the single-course form of `outline` with the time ledger attached.

**Core extensions B needs** (identical to `goals` B): expose `expectedVersion` through
`PluginApi.setFields` (the mutation core already honours it — `mutate.ts:125` — but the plugin API
only forwards `dryRun`), and "typed create" so `create` can write numeric/reference fields without
a second round-trip. The only schema change is the optional `course_target` addendum above; `study`
is unchanged.

## Delivery C — the study timer (`start` / `stop`)

Activates `study_started` / `study_ended`, which contract §1.4 reserves and leaves unused in A.

- **`courses start <lesson|course>`** — create an open study note: `study_course` (resolved from
  the lesson's chapter when a lesson is given), optional `study_lesson`, `study_started` = now as an
  ISO-8601 instant with offset, no `study_amount`. Errors if an open study already exists in scope
  (decision 3).
- **`courses stop [study]`** — resolve the open study (the single started-and-unended one, or the
  named query), set `study_ended` = now and `study_amount` = elapsed minutes (reusing delivery A's
  `units` helper), status implicitly "closed" by having both bounds. Returns a mutation outcome.
- **Doctor.** Extend delivery A's checks with `courses:open` (info/warning) — a study started more
  than N hours ago with no end — mirroring `goals:open`. This is the one doctor addition in B–D.

No core change beyond B.

## Delivery D — the courses tree screen

Not a generic home table: a **dedicated screen**, opened by `Space → C`, the way the calendar opens
its own screen (`chords.tsx:24`, `openHomePanel`). The courses view it shows is a collapsible,
two-branch tree with inline actions. Split into two increments so a usable screen lands before the
harder renderer. Tree decisions settled 2026-11-08 are marked inline.

### Node model — two branches per course

A course node has two **synthetic grouping nodes** beneath it (no `PanelNoteRef`, not openable, pure
expand/collapse containers), **Chapters first, Sessions second**:

```
CS50  ·  3/24 lessons · 6h30m · active
├─ Chapters
│  ├─ Week 0 — Scratch   1/3
│  │  ├─ ✓ Functions
│  │  └─ ○ Loops          [start]
│  └─ Week 1 — C          2/5
└─ Sessions  (12)
   ├─ ⏱ running · 0h42m          ← the open study, highlighted; `stop` acts on it
   ├─ 90m · 2026-11-08
   └─ 45m · 2026-11-07
```

- **Chapters branch**: chapter → lesson, the content hierarchy, glyphs `✓ · ○`.
- **Sessions branch**: every study of the course (all carry `study_course`), newest first; **not**
  nested under the lesson a session names — a session's `detail` mentions its lesson instead, to
  avoid double-showing. The one open study is highlighted with `⏱` and live elapsed.
- This mirrors the contract's own content-vs-sessions split. `Space` on a grouping node offers no
  verbs (they have no note type).

### Core extension — an interactive `tree` kind of `PanelData` (decision 5: generic)

A plugin cannot ship an Ink screen (layer boundary, `docs/plugins.md`), so the designed view is
delivered as data the core renders. Add a `tree` kind alongside `list | table | text`:

```ts
| { readonly kind: 'tree'; readonly roots: readonly TreeNode[] }

interface TreeNode {
  readonly id: string;
  readonly label: string;           // "✓ Functions" — glyph + title
  readonly detail?: string;         // "3/24 lessons · 6h30m" on a course row
  readonly note?: PanelNoteRef;     // Enter opens it; its type scopes the leader verbs. Absent = grouping node
  readonly expanded?: boolean;      // initial state; see expansion rule. Grouping/leaf nodes ignore it
  readonly actions?: readonly { readonly key: string; readonly label: string }[]; // inline [done]/[start] spans
  readonly children?: readonly TreeNode[];
}
```

The `tree` kind is generic — `goals` (goal → sessions) can render in it too, so it lives in the core,
not in `courses`.

**Cursor and actions (decision 1a).** The core renders collapsibly and tracks a cursor over nodes
**and** their inline action spans, reusing the reference cursor machinery
(`referenceAt`/`referencePositions`). Dispatch:

- `j`/`k` move between visible nodes; `h`/`l` collapse/expand the node (`Space` is the leader,
  `Enter` opens — so neither can toggle); `Tab`/`→` steps the cursor onto a node's action spans.
- **`Enter` on a node body → open its note; `Enter` on an action span → run that action** against
  _that_ node (no query, no ambiguity — the per-child verb targets where the cursor is).
- **Division of labor:** inline spans carry **per-child verbs** (`done`/`start` on this lesson); the
  **`Space` leader menu** carries **note-level verbs** (`log`/`set target`/`stop`) scoped to the
  focused node's type.

**Expansion rule (decision 3 — derived, no field).** A node's initial `expanded` is derived, never
stored in frontmatter: a course with `course_status: active` starts **expanded**, `completed`/
`paused`/`dropped` **collapsed**; a chapter starts expanded if it holds the `in-progress` lesson.
The viewer's `h`/`l` overrides it, and expansion is **remembered per session** across the reload an
action triggers, so `done` does not re-collapse the tree.

### D1 — the tree screen + leader menu

- `courses.home` (placement `home`, chord `C` — verify free in ADR 0003) returns `kind: 'tree'`:
  roots are courses (`detail` = `formatProgress` text; `ProgressBar` cell is the decision-4
  extension, added with `goals` D), under each the Chapters and Sessions branches above. Collapsed
  per the expansion rule, so inactive courses are one line until expanded.
- **Leader menu scoped by the focused node's type** (decision 6): `Space` opens the which-key popup
  built from `registry.ownerOf(node.note.type)` → that type's note-level verbs. On a course:
  `l log · s start · t set target`; on a study: `x stop · v void`. Verbs with no value run on the
  key; `log`/`set target` open an input form (see below).

### D2 — inline action spans

Fills `TreeNode.actions`: a lesson row shows `[done]`/`[start]`, a running-session row `[stop]`,
each a focusable span activated by `Enter` (decision 1a). D1 can ship with `actions` empty and D2
adds the spans; both are the same `tree` renderer.

### Declaring node actions (decision 4)

`PanelAction` gains the fields that drive both surfaces from one list, filtered by the focused node's
type:

```ts
readonly appliesTo?: readonly string[];   // node/note types this verb is offered for
readonly surface?: 'inline' | 'menu';     // a span on the node, or an entry in the Space menu
readonly inputs?: readonly PanelInput[];   // the log / set-target form
```

### Note panel `courses.note` (placement `note`, `appliesTo: 'owned'`)

Inside a single note, a **focused subtree** of the same `tree` renderer: a course shows its own
subtree; a chapter/lesson shows its branch and the course's progress; a study shows what it counts
toward. Same nodes, same inline actions, scoped to one note.

**Core extensions D needs**, gathered: the generic `tree` `PanelData` kind with a cursor over nodes
and focusable action spans; the `appliesTo`/`surface`/`inputs` fields on `PanelAction` (none exist
today); and the `ProgressBar` cell for the `detail` bar (shared with `goals` D). The `tree` renderer
is the one substantial build; the rest are small and partly shared with `goals`.

## Deliveries and core extensions

| Delivery        | Ships                                                                                                                                           | Core change                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A ✓ (`0bafda3`) | Schema, templates, `progress`, `units`, `invalid`/`orphan` checks, fixtures — shipped.                                                          | `FieldType: 'reference'`; `FieldSpec.types` (both already in the core, used by `goals`).                                            |
| A′ ✓            | `course_target` field (schema addendum).                                                                                                        | Typed `create` (`CreateNoteInput.fields`).                                                                                          |
| B ✓             | `courses outline`, `done`, `log`, `new`, `show`; dry-run; `outline.ts`.                                                                         | Typed `create` (above); readers reject on any field problem.                                                                        |
| C ✓             | `courses start` / `stop`; `courses:open` doctor check; open-study model.                                                                        | None beyond B.                                                                                                                      |
| D1 ✓            | The courses **tree screen** (`Space → C`), collapsible with derived expansion; inline `[done]`/`[stop]` verbs; leader menu scoped by node type. | A generic `tree` `PanelData` kind + `TreeNode`; `PanelAction.appliesTo`/`surface`/`inputs`; tree renderer.                          |
| D2 ✓            | The creating verbs from the tree (`start`/`log`/`set target`) via the leader menu + input form; the `courses.note` outline panel.               | `PanelAction.run` result widened (a `{ message }` variant) for creates; `PanelAction.inputs` rendered by the core (`ActionInputs`). |

A′–D2 are shipped. D1's inline verbs are the mutation ones (`done` on a lesson, `stop` on a running
study); D2 adds the creating verbs through the leader menu, collecting values in the core-rendered
`ActionInputs` form (the `log` amount/unit, the `set target` date) and reporting a plain message
since `create` returns a note, not a `MutationOutcome`. The `courses.note` panel is a text outline
of the focused note's course (a tree there would need the collapse cursor `NoteView` lacks). Left
for later: the `ProgressBar` cell for the course headline (shared with `goals` D), and an inline
focusable-span cursor so `Enter` on a `[done]` span runs it (today the inline key does). The generic
`tree` panel kind is the one substantial core build, reusable beyond `courses`.

## Testing

Against the `test/` fakes, exactly as `goals`/`todos` test (`contract.test.ts`, `plugin.test.ts`):

- **Commands.** `outline` orders chapters/lessons and formats progress; excludes invalid notes;
  `done` is a dry-runnable `setFields`; `log` creates a study with a numeric amount, honours
  `--unit`/`--on`/`--lesson`; `new` resolves the parent query and assigns the next `*_order`.
- **Timer.** `start` then `stop` yields `study_amount` = elapsed; a second `start` while one is open
  errors; `stop` with two open studies errors naming both.
- **Tree screen.** `courses.home` returns a `tree` whose nodes carry resolvable `PanelNoteRef`s and
  collapse below the course row; the leader menu offers a course's verbs but not a study's; an inline
  `[done]` span on a lesson node round-trips through `api.setFields`; `courses.note` renders the
  focused subtree for a course and the branch for a lesson.
- **Capabilities.** `notes capabilities --json` lists every new command (the plan.md definition of
  done).

## Out of scope

Enrolment/calendar scheduling, spaced-repetition over lessons, a background timer service, and any
coupling to `goals` (a course→goal link stays an ordinary note reference, contract §intro). No
shared units module — `courses` keeps its own local helper, per contract §4.
