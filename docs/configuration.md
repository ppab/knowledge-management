# Configuration

There are two configuration files, at two scopes:

- **Vault configuration** — `.notes/config.yaml`, one per vault, describing that vault.
- **User configuration** — `$XDG_CONFIG_HOME/notes/config.yaml` (default `~/.config/notes/config.yaml`),
  one per user, describing preferences that span vaults.

Both are YAML, validated with Zod (`src/infrastructure/config/{vault,user}-config.ts`). A missing
user config is treated as empty; an invalid vault config is a `VALIDATION` error at vault open,
reporting the offending `path` and message rather than crashing.

> The per-type schema a plugin adds to its own notes is a different thing — those are _fields_, not
> configuration. See [plugins.md](./plugins.md) §2.

## 1. Vault configuration — `.notes/config.yaml`

| Key | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `vault.id` | string | yes | — | permanent identity; never edited by hand |
| `vault.name` | string | yes | — | display name |
| `notes.include` | string[] (globs) | no | `['**/*.md']` | at least one entry |
| `notes.exclude` | string[] (globs) | no | `[]` | |
| `identity` | union (below) | no | `{ strategy: ulid }` | how new note ids are minted |
| `editor` | string | no | — | overrides `$EDITOR` for the editor handoff |
| `plugins` | map `name → settings` | no | — | which plugins are enabled, and their settings |
| `publications` | map `name → publication` | no | — | publish targets (below) |

### `identity`

A discriminated union on `strategy`; the `formatted` strategy carries one extra key:

```yaml
identity: { strategy: ulid } # the default
# identity: { strategy: uuidv7 }
# identity: { strategy: formatted, format: 'YYYY-MM-DD-{{seq}}' }
```

### `plugins`

A map whose key is the plugin name and whose value is that plugin's settings. An empty value means
"enabled, default settings":

```yaml
plugins:
  todos: {} # enabled, defaults (a bare `todos:` is the same)
  courses: {}
  goals: {}
```

No `plugins:` key means no plugins are enabled. Each plugin validates its own settings via
`settings()`, so the settings shape is plugin-specific and otherwise opaque to the core. (Only
_enablement_ is generic today; there is no declared schema for a plugin's settings the way there is
for its note fields — a settings-schema is a known gap.)

### `publications`

A map whose key is the publication name. Each publication:

| Key | Type | Required | Default | Allowed values |
| --- | --- | --- | --- | --- |
| `destination` | string \| `{ kind, …options }` | yes | — | kinds: `markdown`, `html`, `astro` |
| `output` | string (path) | yes | — | where files are written |
| `route` | string (template) | no | `/{{slug}}/` | |
| `include` | string[] (globs) | no | `[]` | |
| `exclude` | string[] (globs) | no | `[]` | |
| `vaults` | string[] | no | — | restrict to these vaults (≥1); omit for all in scope |
| `references` | enum | no | `fail` | `fail` \| `strip-to-label` \| `keep-id` |

The `destination` is a bare kind when it needs no options (`destination: markdown`), or a `kind`
plus options the destination itself declares and validates (ADR
[0007](./decisions/0007-destination-options.md)). Because the options are declared as `OptionSpec`
data, tools can discover them from `notes capabilities` rather than hard-coding them. Built-in
options:

- `markdown` — `layout`: `flat` \| `directory`
- `html` — `description` (string); `layout`: `flat` \| `directory`
- `astro` — `theme`: a theme name (e.g. `modular`); `collection`: values that **depend on the chosen
  `theme`** (a dependent enum)

```yaml
publications:
  site:
    destination: { kind: html, layout: directory }
    output: ./dist
    include: ['notes/**']
    references: strip-to-label
  blog:
    destination: { kind: astro, theme: modular, collection: pages }
    output: ../site/src/content
```

## 2. User configuration — `~/.config/notes/config.yaml`

Spans vaults; holds preferences, not facts about any one vault. Vault paths may be absolute,
`~`-relative, or relative to the config file's directory.

### `scopes` (implemented)

Named composite scopes — a set of vaults addressed together:

```yaml
scopes:
  work:
    vaults: [~/notes/work, ~/notes/team] # ≥1 vault
```

Default `{}` (no named scopes).

### `tui` (proposed — not yet implemented)

Defined by ADR [0003](./decisions/0003-workspace-layout-and-leader-key.md) (workspace + leader) and
ADR [0008](./decisions/0008-key-bindings-and-input-routing.md) (configurable bindings). Documented
here so a settings UI can account for it, but the user-config schema does **not** parse it yet;
building a screen that edits it means implementing its config side.

```yaml
tui:
  leader: ' ' # the leader key; default Space
  layout: focus # which named layout to start in; `focus` is built in
  layouts: # name → ordered list of columns
    review:
      - { width: 1fr, panels: [main] } # width: '1fr' | '2fr' | '28' (cells)
      - { width: 1fr, panels: [core.backlinks, todos.open] } # panels by id
  keys: # action-id → key | key[]  (ADR 0008)
    list.open: enter
    note.edit: e
    list.delete: [d, delete]
```

## 3. Building a settings screen

Notes for a TUI configuration screen over the above:

- **Two scopes, two regions.** Vault settings edit the active vault's `.notes/config.yaml`; user
  settings edit the shared file. Under a composite scope, decide whether the screen edits one chosen
  vault or several.
- **Widget kinds:** text input (`vault.name`, `editor`, `output`), enum picker (`identity.strategy`,
  `references`, destination `layout`/`theme`), glob-list add/remove (`include`/`exclude`), a toggle
  per plugin, and a **nested keyed-collection editor** for `publications`, `scopes` and `layouts` —
  those are the involved ones.
- **Conditional / dependent fields:** `identity.format` appears only for `formatted`; a destination's
  options depend on its `kind`; astro's `collection` depends on its `theme`. The form must re-render
  sub-fields when the parent changes.
- **Data-driven where possible:** destination options come from `OptionSpec` (discoverable via
  `capabilities`), so the publications sub-form can be generic. Plugin _settings_ cannot be rendered
  generically yet (opaque `unknown`); only enable/disable is generic.
- **Read-only:** `vault.id`.
- **Live vs proposed:** everything under `tui:` is spec-only; editing it is also implementing ADR
  0003/0008's config side.
