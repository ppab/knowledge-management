# 0005 — Capture, the entry model, and the verb vocabulary

Date: 2026-11-06 · Status: proposed (no implementation milestone yet)

## Context

The system is, at bottom, a way to capture information in a structured way and keep it as plain
Markdown. Notes are only one shape of that. Time records, financial records, reading logs, and
anything else a user wants to track are the same substrate — a Markdown file with structured
frontmatter and a body — distinguished by which business logic applies to them. That business
logic is exactly what the plugin system already injects per `type` (see
[plugins.md](../plugins.md) and [0004](./0004-inkjs-ui-adoption.md) for the current shape).

So the generalization is not new architecture; it is already here. `Note`
(`domain/note/note.ts`) carries an optional `type`, arbitrary `fields` "the core does not
interpret, what plugins query by" (`domain/note/summary.ts`), `tags`, `dates`, and
`visibility`. The plugin contract says it out loud: _"A plugin gives meaning to a kind of note:
it owns frontmatter `type` values, declares the fields those notes carry."_ A todo is already
just an entity with `type: todo` and fields `{status, due}`; a time record would be `type:
time` with `{start, end}`.

What is wrong is the **naming**, and the naming lies in a way that blocks the product from
feeling designed:

- The word **note** does two unrelated jobs: it names the universal substrate
  (`Note`, `NoteStore`, `NoteIndex`, `NoteSummary`, `createNote`) _and_ the plain, freeform
  thing a human calls a note. The union type already reached for the better word for the first
  job and only half-committed — `EntrySummary`, `NoteEntry`.
- The verbs grew by accretion, not design: four dialects for "put something in"
  (`create` an entry, `reference add` a link, `snippet insert` a fragment, `bind` a date), two
  words for "take out" (`delete` an entry, `reference remove` a link), and the single most
  important relationship verb buried under a noun sub-command (`reference add`).
- `save` records a _revision_, but entries are plain `.md` written to disk immediately —
  nothing is ever "unsaved", so the word misdescribes the act.

This ADR settles the concept model, the product name, and the verb vocabulary so that later
work renames against a fixed target instead of re-deciding each time.

## Decision

### The product is **Capture**

The system captures structured information. The hero verb (`capture`) and the product name are
the same word on purpose — `capture todo "ship it"`, `capture expense "lunch"`,
`capture "a loose thought"` reads like the product's thesis in one line. The **binary/command
name** (`notes` today) is a separate, lower-stakes decision left open; renaming the base
concept does not force the command to stop being `notes`.

### The base concept is an **Entry**

Rename the universal substrate from `Note` to `Entry` throughout domain, application and ports
(`Note → Entry`, `NoteStore → EntryStore`, `NoteSummary → EntrySummary` — already the union
name — `NoteIndex → EntryIndex`, `createNote → captureEntry`, and so on). `Record` was
rejected: it collides with TypeScript's `Record<K, V>`, which the frontmatter types use
everywhere. `Entry` is neutral, covers notes, time and finance equally, and is already present
in the codebase.

An **Entry** is the unit: a Markdown file with an identity and a document skeleton — `id`,
`title`, `body`, `headings`, `references`, `aliases`, `created`. The core owns the skeleton;
plugins own everything type-specific.

### Two orthogonal axes, named cleanly

Today `kind: 'note' | 'unidentified'` tangles two different classifications. Separate them:

- **`type` — the domain axis.** Optional. Its _absence_ means a **raw, unclassified capture**
  (the inbox): an entry thrown in without saying what it is. A present value — `note`, `todo`,
  `time`, `expense` — means it has been **classified**, and a plugin may own that type's fields
  and logic. (`note` is the trivial type: prose with no required fields, so it need not ship a
  plugin.)
- **Identity axis.** Identified vs. `unidentified` (a file matched by the vault's globs that has
  no `id` yet and cannot be mutated or referenced until `adopt`ed). Today's `kind` becomes this
  axis alone (e.g. `'entry' | 'unidentified'`, or an `identified` boolean).

**A note is a type of entry, not the base.** A raw (typeless) entry and a `note` can look
identical on disk; the difference is _declared intent_ — "haven't filed this yet" vs. "filed as
a note". That inbox-vs-filed distinction is the core loop of a capture tool (_capture now,
classify later_), so it is a feature, not a duplication. This is why the core stays fully
type-agnostic: `type` is purely the plugin extension point, and the core never knows a single
type name.

### The verb vocabulary

Two tiers that must not bleed into each other.

**Tier 1 — universal entry verbs (the product's spine).** They act on any entry, know nothing
about its type, and the set is _closed_: a new type never widens or forks a Tier-1 verb.

| Verb                             | Replaces                                                   | Note                                                                                             |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `capture [type] "title"`         | `create`                                                   | the hero verb; type is an argument, absent = raw capture                                         |
| `classify <query> <type>`        | — (new)                                                    | promote a raw entry into a type, or retype one — the verb that makes the inbox loop real         |
| `show` / `list` / `search`       | same                                                       | the read trio                                                                                    |
| `edit`                           | same                                                       | body in `$EDITOR`                                                                                |
| `link` / `unlink` / `relabel`    | `reference add` / `reference remove` / `reference relabel` | relationship verbs promoted to top level; `unlink` also retires the `delete`/`remove` split      |
| `delete`                         | same                                                       |                                                                                                  |
| `adopt`                          | same                                                       | bring an untracked file under identity; pairs with `capture` as import-vs-create                 |
| `snapshot`                       | `save`                                                     | records a revision; "save" misdescribed an always-persisted file                                 |
| `history` / `diff` / `backlinks` | same                                                       | the time + graph layer                                                                           |
| `publish`                        | `export`                                                   | write a selected scope of entries to Markdown/HTML + manifest, SSG-agnostic; originals untouched |

**Tier 2 — type verbs (plugin-contributed).** Each type names its own actions, scoped to that
type: todo → `done` / `reopen`, a time record → `start` / `stop`, an expense → `categorize`.
A new type adds its own verbs; it never special-cases a Tier-1 verb.

**Left as-is for now:** `snippet insert` (a text op, genuinely distinct — keep `insert`) and
`bind` (attach a calendar date — jargon, but kept as a calendar verb; a later change may fold
it into a general field-set).

### Publishing is a Tier-1 verb, entry-based

`publish` (the CLI's `export` today) takes a selected scope of entries and writes a portable
copy, leaving the originals untouched. The design already exists — `architecture.md` §7 (the
`planPublication` → `executePublication` pipeline) and `plan.md` M8 — and only needs restating
in entry language:

- Selection is by vault globs and **`visibility`** (`public` / `private`; absent ⇒ private,
  default-deny) — the same field on an entry.
- `planPublication` is pure: assign routes (from `slug` or slugified title), detect route
  collisions, and classify every reference as `published` / `excluded` / `unresolved` with
  policy `fail` (default) | `strip-to-label` | `keep-id`. Only a zero-violation plan proceeds.
- `executePublication` writes Markdown (reference → relative link) or **HTML body fragments**
  plus `manifest.json` (`id, title, route, path, dates, tags`), and never opens a source entry
  for writing.
- **SSG-agnostic by design** (assumption A7: _"body fragments + manifest.json; layout belongs
  to the static site generator"_): the export feeds Astro / Eleventy / any generator rather
  than coupling to one, and it transforms id-based `[[…]]` links into portable links/routes —
  the problem a "the vault _is_ the content folder" approach sidesteps by avoiding wikilinks.

Naming note: the verb is `publish` (fits the Capture voice); the concept/noun stays
_publication_. Not scheduled beyond M8's existing plan; this only records that `publish` is part
of the spine and entry-based.

### Shortcuts — configurable front doors per type (deferred; documented here, implemented later)

Each type gets an optional top-level **shortcut** that is pure sugar over `capture <type>`:
`track "25m"` ≡ `capture time "25m"`, `spend 12.50 lunch` ≡ `capture expense …`. The canonical
`capture <type>` form always works for every type and remains the discoverable spine; a shortcut
never widens `capture`, it only aliases it.

- **Two sources, default + override.** A type _ships a default shortcut_ (the time plugin
  suggests `track`); the **vault configuration is the first-class home** to add, remap, or
  disable them. Config shape is an inverse map, `verb: type`, which reads well and makes
  collision-checking trivial:

  ```yaml
  # .notes/config.yaml
  shortcuts:
    track: time # `track …`  ≡  `capture time …`
    spend: expense
    note: note # even the default type can have a front door
  ```

- **Collision safety reuses the registry pattern.** The TUI already refuses to start when a
  plugin chord clashes with a core or reserved chord (`buildTuiRegistry` → `VALIDATION`). The
  same rule applies: a shortcut that collides with a Tier-1 verb (`capture`, `list`, `delete`,
  …) or with another shortcut is rejected at load, naming both.

- **Scope: capture-only to start.** A shortcut maps a verb to `capture <type>`. Read-shortcuts
  (`todos` ≡ `list --type todo`) are an obvious later generalization, deliberately left out so
  the grammar stays small.

- **Vocabulary caution.** These are **shortcuts**, never "aliases". `alias` is already taken by
  frontmatter `aliases:` — the id that makes `[[…]]` resolve in Obsidian (see
  [0005's companion work on Obsidian links] and `createNote`'s alias pass). Reusing the word
  would re-open the one-word-two-jobs problem this ADR exists to close.

## Why these and not the alternatives

- **Note as the base, plugins as a sidecar:** the status quo. It forces the core to privilege
  one shape forever and leaves `note` meaning two things. Rejected — it is the problem.
- **Every entry must have a type, `note` as the built-in default** (so no typeless entries): a
  uniform model, but the core must then ship and maintain a `note` type and is no longer purely
  type-agnostic, and it erases the inbox (raw-capture) state that gives a capture tool its
  reason to exist. Rejected in favour of "absence of type = raw capture".
- **`Record` for the base concept:** clearer domain word, but a direct name clash with
  TypeScript's `Record<K, V>` used throughout the frontmatter types. Rejected for `Entry`.
- **Keeping `create` / `save` / `reference add`:** familiar, but they are the accreted
  inconsistencies this ADR is fixing; `capture` / `snapshot` / `link` give the surface one
  voice.
- **Shortcuts as a new top-level grammar now:** more power, but it muddies the just-settled
  spine before the rename lands. Documented and deferred.

## Consequences

- **This is overwhelmingly a rename, not a restructure.** The typed-record substrate, the
  `type`/`fields` extension point, and the plugin contract already exist; `NoteBase` already
  separates the universal skeleton from the typed layer. Frontmatter on disk is unaffected —
  existing vaults keep working — so the change is names and verbs, sequenced into a future
  milestone, not a data migration.
- **Docs to follow when implemented:** `architecture.md` (the domain vocabulary and the CLI
  synopsis), `plugins.md` (restate the contract in terms of _entries_ and _types_, and add the
  type-shipped default shortcut), and the goals/plan docs for sequencing.
- **CLI surface:** `create → capture`, `save → snapshot`, `reference add/remove → link/unlink`,
  `export → publish`, new `classify`; `relabel`, `delete`, `adopt`, `show`, `list`, `search`,
  `edit`, `history`, `diff`, `backlinks` keep their names. `bind` and `snippet insert` are
  untouched for now.
- **Config:** `.notes/config.yaml` gains an optional `shortcuts` map (inverse `verb: type`),
  validated like the other config sections, with load-time collision rejection. Not built yet.
- **Binary name** (`notes`) is intentionally not decided here.
- **Not scheduled.** Status is _proposed_; this records the agreed target so later work renames
  against a fixed design rather than re-deciding.
