# Goals: the contract

Status: delivery A of issue #6, 2026-10-28. This document fixes the Markdown, the rules and the
invariants of the `goals` plugin before any command exists. Deliveries B–E implement it; where a
rule needs a core extension, the section says which delivery brings it.

Goals distinguishes the **desired outcome** (pass the CKA) from the **work commitment** you can
control (160 hours before a date), and measures the commitment from **confirmed records** only.
Markdown stays the source of truth; the index can be deleted and rebuilt without losing a session,
a goal or the link between them.

## 1. Notes

Two owned types, one note each, no imposed directories. Every field is prefixed because the
registry rejects a field name declared with different enum values by two plugins (`todos` owns
`status`).

### 1.1 Goal (`type: goal`)

```markdown
---
id: 01JB…
title: Pass the CKA
type: goal
goal_target: 160
goal_unit: hours
goal_due: 2027-03-31
goal_outcome: CKA certification
goal_status: active
goal_open_session: '[[01JC…]]'
---

# Pass the CKA

## Why

## Strategy

## Risks

## Review 2026-11-30

…
```

| Field               | Type       | Required | Meaning                                                                |
| ------------------- | ---------- | -------- | ---------------------------------------------------------------------- |
| `goal_target`       | number > 0 | yes      | The committed amount, in `goal_unit`.                                  |
| `goal_unit`         | string     | yes      | `hours`, `minutes`, or any name of your own (§3).                      |
| `goal_due`          | date       | no       | The date the commitment runs to. Informational in A; agenda in D.      |
| `goal_outcome`      | string     | no       | The desired result. Completing the work never implies reaching it.     |
| `goal_status`       | enum       | yes      | `active`, `achieved` (outcome reached, set by you) or `dropped`.       |
| `goal_open_session` | reference  | no       | The session registered as running (§5). Set and cleared by the plugin. |

Motivation, difficulty, risks and strategy live in the body. Reviews are dated `## Review
YYYY-MM-DD` sections appended by `insertSnippet` (§8); nothing else edits the body.

### 1.2 Session (`type: session`)

```markdown
---
id: 01JC…
title: Lab 3
type: session
session_goal: '[[01JB…]]'
session_status: confirmed
session_amount: 90
session_unit: minutes
session_started: 2026-10-27T18:00:00+01:00
session_ended: 2026-10-27T19:35:00+01:00
session_key: lab-3
dates: [2026-10-27]
---

# Lab 3

Services and ingress. Lost 5 minutes to a cluster restart.
```

| Field             | Type       | Required          | Meaning                                                                    |
| ----------------- | ---------- | ----------------- | -------------------------------------------------------------------------- |
| `session_goal`    | reference  | yes               | The goal, as a wikilink (§2).                                              |
| `session_status`  | enum       | yes               | `open` (timer running), `confirmed` (counts), `void` (kept, never counts). |
| `session_amount`  | number ≥ 0 | when `confirmed`  | The confirmed amount. Absent while `open`.                                 |
| `session_unit`    | string     | no                | Unit of `session_amount` when it differs from the goal's (§3).             |
| `session_started` | instant    | when `open`       | ISO 8601 with offset; the measured start.                                  |
| `session_ended`   | instant    | no                | ISO 8601 with offset; the measured end. Never before `session_started`.    |
| `session_key`     | string     | no                | Idempotency key of a manual log (§6). `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.   |
| `dates`           | core       | yes, at least one | The work day is the first binding; so sessions appear in the calendar.     |

A session has its own identity because it must be correctable and referenceable on its own.
Measured time (`started`/`ended`) and confirmed work (`amount`) are different things: the file
keeps both, only the amount counts.

### 1.3 Templates

`goals/goal` and `goals/session` are built in (a vault's `.notes/templates/goals/*.md` wins).
They carry **no numeric fields**: a `{{placeholder}}` always substitutes as a YAML string, and a
string `"160"` is not a number. `goals new` and `goals log` (delivery B) write the numbers
through the typed create path. A goal created from the raw template is complete only once
`goal_target` is set; `doctor` says so (`field` / `missing`).

## 2. The link: a wikilink in a field

`session_goal: "[[ID]]"`. A frontmatter string that is exactly one `[[ID]]` or `[[ID|Label]]`
is a **field reference** by core convention, whatever plugins are enabled (`parseFieldReference`
in `domain/reference`). The meaning is in the Markdown, so an index rebuild with the plugin
disabled keeps the relation, and an editor that understands wikilinks shows it. A bare id is
never a link, because ids may not contain brackets.

`FieldType: 'reference'` (core, delivery A) means "this field must hold a wikilink"; `doctor`
validates it. Delivery B teaches the index to record field references beside body references
with an explicit origin, `{ kind: 'field', key }` versus `{ kind: 'body', range }`, so
`backlinks` and `dangling` see both. `Note.references` stays body-only; `removeReference`
refuses a field origin and points at `setFields`. No body `[[id]]` is duplicated for sessions.

## 3. Units and amounts

- The goal fixes the unit. `hours` and `minutes` form the **time dimension** and convert
  exactly (60). Every other unit is **opaque**: it matches itself and nothing else.
- A session's amount is in `session_unit` when given, else in the goal's unit. `90 minutes`
  counts `1.5` toward a goal in hours; `40 pages` never counts toward hours.
- Nothing is summed across dimensions, silently or otherwise. An incompatible or missing
  amount excludes the session with a stated reason (§4) and `doctor` reports it.
- No canonical value is stored beside what you wrote; conversion happens on read.
- Display is in the goal's unit: `3h30m / 160h`, `40 pages / 300 pages`.

## 4. Progress

`progressOf(goal, sessions, now)` is a pure function over index entries:

- **Counted**: sessions of the goal, in the goal's vault, `confirmed`, with an amount whose
  unit converts to the goal's. `confirmed` is their sum in the goal's unit.
- **Excluded**, each with its reason: `void`; unit does not convert; lives in another vault;
  no amount. A session whose goal is not in scope is reported by `doctor`, not counted anywhere.
- **Open**: sessions with `session_status: open`, never counted, shown with elapsed time.
- `percent` is floored and capped at 100 for bars; `confirmed` keeps the overshoot.
- Reaching the target sets `reached`, and **never changes `goal_status`**.

Goals compute in the plugin over `list()`; no aggregation infrastructure is added.

## 5. Open sessions and the timer

The timer is state in the session note; no process counts time.

- **Start** (delivery C): read the goal at version `v` and refuse if it names a running session;
  create the session with `session_status: open`, `session_started: <now with offset>` and the
  day in `dates`; then set `goal_open_session: "[[session]]"` on the goal with
  `expectedVersion: v`. Two cooperating starts cannot both pass that compare-and-swap (the
  single-file guarantee of #2); the loser sets its own session to `void` and returns `CONFLICT`.
  If the goal changed for an unrelated reason, re-read once and retry the pointer write.
- **Running** means _registered_: the session named by `goal_open_session`. At most one per
  goal. Several goals may run at once. No pauses: stop and start again.
- **Detached**: an open session the goal does not name (a crash between the two writes above,
  or a hand edit). `doctor` reports it (`goals:open`), the panel shows it, it can be stopped or
  voided, and it never blocks a new start.
- **Stale**: an open session older than 12 hours. Flagged in panel and `doctor`, never closed
  automatically. The threshold is confirmed, not a default to tune.
- **Stop** (delivery C): write `session_ended`, `session_amount` (the measured time proposed,
  editable, so a forgotten timer is corrected by confirming less) and `session_status:
confirmed` with the version read when the dialog opened. Then clear `goal_open_session`
  **only if it still names this session**, with the goal's expected version. Never clear or
  replace a pointer that names another session: a retry of an older close must not disturb a
  newer timer. Repeated stop requests on a closed session are a no-op (`written: false`).
- **Void** follows the same pointer rule.
- Sessions are always created in the goal's vault; `--in` is not accepted for sessions.

Required tests (C), on real temporary Markdown and the SQLite index, with controlled
interleavings: two simultaneous starts → one registered, one void, one `CONFLICT`; closing an
older session while a newer one becomes registered → the newer pointer survives; closing a
detached session while another is registered → pointer untouched; repeated close; interruption
between the session write and the pointer cleanup → confirmed work preserved, `doctor` tells a
stale pointer from a running session.

## 6. Manual logging and `--key`

`goals log <goal> <amount> [--unit u] [--on YYYY-MM-DD] [--note text] [--key k]` (delivery B)
creates a `confirmed` session in the goal's vault. Without `--key`, every call creates.

With `--key`, the operation is idempotent within its scope: **vault + goal + operation `log` +
key**. The key is persisted as `session_key`, so it survives an index rebuild and a file move.

1. **Lookup first.** After the scope refresh that precedes every read, find a session of this
   goal in this vault with this `session_key` (`byField`). Found with the same normalized data
   (goal, amount, resolved unit, day, note text) → return it, `written: false`. Found with
   different data → `CONFLICT` naming the existing id and the differing fields. Never a second
   session, never silent success.
2. **Create at a deterministic path** derived from goal id and key. `createOnly` fails
   atomically on an existing file, so two first-time concurrent requests create at most one;
   the loser goes back to step 1.

What this does and does not guarantee: among cooperating writers (CLI, TUI, agents through the
CLI) no duplicate keyed session arises, because cooperating writers never relocate notes and
every lookup follows a refresh. After a note is moved by hand, the deterministic path is vacant,
step 1 still finds the note by its key, and a retry returns it. The residual race is a move
performed by a non-cooperating writer _during_ a keyed log; it is the same residual race #2
documents for the store, and `doctor` makes its outcome visible: two sessions with one key in one
goal scope are a `goals:duplicate-key` warning, and one of them is voided by hand.

Required tests (B): same key, same data → same id, `written: false`; different data → conflict;
same textual key on another goal → independent; retry after a lost response; create → move the
file within the vault → rebuild the index → retry (same id, no duplicate; different data →
conflict); concurrent keyed retries after relocation.

## 7. Fixtures are the contract

`test/fixtures/goals/valid/*.md` are accepted; `test/fixtures/goals/invalid/*.md` are rejected
with the reasons listed in `src/plugins/goals/contract.test.ts`. They run through the real
frontmatter codec and index. Change the contract, change a fixture.

A file of either type without an `id` is not a goal or a session: the core reports it as
`unidentified` and the plugin never sees it (`invalid/session-unidentified.md`).

The valid set covers: a time goal with a registered open session; an opaque-unit goal; a manual
session; a session in minutes with a key; a timed session where measured and confirmed differ;
an open, registered session; an open, detached and stale session; a void session; a session in
an incompatible unit; a session whose goal is outside the scope.

## 8. Reviews

A review is a dated `## Review YYYY-MM-DD` section appended to the goal's body through
`insertSnippet` (delivery E), with the plugin's `review` snippet. Adjusting the commitment edits
`goal_target` or `goal_due` through `setFields`; sessions are never touched, so progress against
a new target is recomputed from the same records. Nothing deletes history.

## 9. Diagnostics

`doctor` reports, per note, with `goals:` kinds:

| Kind                  | Severity               | When                                                                       |
| --------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `field` (core)        | warning / info         | A declared field has the wrong shape; names the key and the expected form. |
| `goals:invalid`       | warning                | A goal or session the contract rejects, with every reason.                 |
| `goals:excluded`      | warning (`void`: info) | A valid session that does not count: unit, vault, missing goal, void.      |
| `goals:open`          | info / warning         | Open session stale or detached; a goal pointer naming a non-open session.  |
| `goals:duplicate-key` | warning                | Two sessions with one `session_key` in one goal scope (delivery B).        |

Invalid external edits stay Markdown, are never reinterpreted, and get these diagnostics.
Disabling the plugin keeps every note readable; the only thing lost is the checks.

## 10. Deliveries and core extensions

| Delivery | Ships                                                                                         | Core change                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A        | This contract; schema, templates, `doctor` checks; pure `units`/`model`/`progress`; fixtures. | `FieldType: 'reference'` validated as a wikilink; `FieldSpec.types` scopes a field to some of a plugin's types.                     |
| B        | `goals new`, `goals list`, `goals show`, `goals log` with `--key`; `capabilities`; dry-run.   | `expectedVersion` on `setFields`; create as plan + write with typed fields and `dryRun`; field references in the index with origin. |
| C        | `goals start`, `goals stop`, `goals void`; detached and stale handling.                       | None beyond B.                                                                                                                      |
| D        | Home panel with `ProgressBar`, goal detail, note panel, declarative inputs for log/stop.      | `PanelAction.inputs` rendered by the core TUI.                                                                                      |
| E        | `goals review`; the external-skill example.                                                   | None.                                                                                                                               |

Out of scope, unchanged from the issue: pauses, a generic record abstraction, a background
service, model integration, a rigid time hierarchy. The calendar type filter is a separate core
item and not a requirement here.
