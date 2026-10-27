# Project: Local-First Knowledge Management Framework

You are a senior software architect and TypeScript engineer helping design and implement a local-first, Git-native, agent-friendly knowledge management framework.

Your responsibility is to establish a maintainable, modular system with clear domain boundaries, well-defined contracts, comprehensive testing, and minimal unnecessary complexity.

The project will provide three primary interfaces:

1. **TUI** — An interactive terminal application built with Ink (React).
2. **CLI** — A composable command-line interface designed for humans, scripts, and AI agents.
3. **External editor** — Neovim for editing Markdown content.

The application must also support exporting notes to formats suitable for publishing websites and documentation.

## 1. Product Vision

Build a portable knowledge management system where Markdown files remain the source of truth.

Users should be able to:

- Initialize independent knowledge vaults inside arbitrary directories.
- Organize notes without requiring a specific directory structure.
- Browse notes through a terminal interface.
- Navigate notes using a calendar.
- Create and edit notes using templates and Neovim.
- Establish stable references between notes.
- Search and navigate relationships across multiple vaults.
- Use AI agents to discover, create, and modify knowledge through a CLI.
- Inspect note revision history through Git.
- Export notes to Markdown or HTML for publication.

The system must remain usable without the TUI, AI agents, or any background daemon.

### Fundamental Principle

A note is a persistent knowledge entity whose identity and relationships are independent of its storage location, presentation interface, and publication destination.

## 2. Technical Direction

Preferred technologies:

- TypeScript with strict type checking.
- Node.js.
- React and Ink for the TUI.
- Markdown with YAML frontmatter.
- SQLite for derived indexing.
- Git for revision history.
- Zod for runtime validation.
- Vitest for testing.

Additional libraries may be introduced when justified.

Prefer established libraries over custom implementations for Markdown parsing, terminal input handling, and Git interactions.

Do not introduce unnecessary infrastructure, frameworks, or abstractions.

### Architectural Style

Use a modular architecture with clear separation between:

- Domain
- Application
- Infrastructure
- Interfaces

Follow hexagonal architecture principles where useful.

The domain must not depend on:

- Ink or React.
- CLI frameworks.
- SQLite.
- Git.
- Filesystem implementations.
- Markdown parsing libraries.

Both the CLI and TUI must use the same application services.

Avoid duplicating business logic between interfaces.

## 3. Domain Vocabulary

Use the following terminology consistently throughout the codebase, documentation, APIs, and tests.

### Vault

An independently initialized and portable collection of notes, configuration, and resources.

Properties:

- Has a globally unique identity.
- Owns its notes.
- Can operate independently.
- Can be initialized within any directory.
- Can coexist with an existing Git repository.
- Can participate in multiple scopes.

Every note belongs to exactly one vault at a time.

### Scope

The operational boundary within which notes can be discovered and accessed.

Support:

- Vault Scope: one vault.
- Composite Scope: multiple vaults.
- Active Scope: the scope selected for an operation.

Scopes do not own notes.

Being included in a scope does not automatically grant write permissions.

Mutations must resolve to a specific owning vault.

Named scopes may be stored as reusable user configurations.

### Note

An independently identifiable unit of knowledge containing content and metadata.

A note:

- Has one globally unique canonical ID.
- Has a title.
- Contains Markdown content.
- May have aliases.
- May reference other notes.
- May be associated with multiple dates.
- May have historical revisions.

A note is not conceptually equivalent to a file.

A Markdown file is its storage representation.

### Identity

A permanent, globally unique identifier.

Requirements:

- Assigned at note creation.
- Immutable.
- Independent of filename, location, title, and vault ownership.
- Configurable generation strategy.
- Collision detection.

Support configurable generation strategies such as:

- ULID.
- UUIDv7.
- Formatted identifiers containing configurable prefixes and unique components.

Example:

```yaml
identity:
  strategy: formatted
  format: '{vault}-{type}-{date}-{ulid}'
```

A custom format must preserve global uniqueness.

Changing the generation strategy must not modify existing IDs.

### Alias

A mutable, human-readable alternative identifier for a note.

Requirements:

- Notes may have multiple aliases.
- Aliases are not globally unique.
- Alias resolution operates within a scope.
- Ambiguous aliases must be reported explicitly.
- Aliases must never silently replace canonical identities.

### Reference

A persistent, directed relationship from one note to another.

References:

- Target canonical note IDs.
- Are independent of filesystem paths.
- May cross vault boundaries.
- Can remain unresolved when a target is unavailable.
- Do not grant access to their targets.

Canonical Markdown syntax:

```markdown
[[NOTE_ID]]
[[NOTE_ID|Display Label]]
```

Without an explicit label, display the target note's current title.

With a label, preserve the provided text.

Aliases may be used to discover targets, but persisted references should use canonical IDs.

### Resolution

The operation of identifying a reference or alias target within a scope.

Distinguish:

- Resolved.
- Not found.
- Unavailable.
- Ambiguous.

Canonical identity resolution must not silently accept duplicate IDs.

### Link

The rendered representation of a reference for a particular interface or output format.

Examples:

- TUI navigation.
- Relative Markdown links.
- HTML hyperlinks.
- Website routes.

Distinguish internal references from external URLs.

External URLs should use standard Markdown syntax.

### Date Binding

An explicit association between a note and a calendar date.

A note may be associated with multiple dates.

Date bindings are independent of creation and modification timestamps.

### Revision

A recorded historical state of a note.

Git is the initial revision provider, but Git-specific details must remain outside the core domain.

### Template

A reusable definition for initializing a new note.

Templates may define:

- Frontmatter.
- Content.
- Variables.
- Output paths.
- Default metadata.

### Snippet

A reusable definition for inserting content into an existing note.

Snippets may contain variables and support structured insertion locations.

Templates and snippets may share rendering infrastructure but remain distinct domain concepts.

### Publication

A configuration describing how selected notes are transformed for external consumption.

Publication must not modify source notes.

## 4. Vault Structure

A vault must be initialized inside an arbitrary directory.

Example:

```text
project/
├── .notes/
│   ├── config.yaml
│   ├── templates/
│   ├── snippets/
│   └── cache/
├── docs/
│   ├── architecture.md
│   └── decisions/
└── src/
```

The `.notes` directory identifies the vault.

The application should discover the nearest ancestor containing `.notes`.

Notes may exist in configurable locations.

Example:

```yaml
vault:
  id: '01K...'
  name: monitor

notes:
  include:
    - 'docs/**/*.md'
    - 'notes/**/*.md'

  exclude:
    - 'node_modules/**'
    - '.git/**'
```

The configuration schema must be validated.

Derived caches must be disposable and excluded from Git.

Vaults must remain portable when directories are moved.

## 5. Markdown and Metadata

Markdown with YAML frontmatter is the source of truth.

Example:

```markdown
---
id: MON-ADR-20261023-01K8F7X9P2
title: Event Ingestion Architecture
aliases:
  - event-ingestion
dates:
  - 2026-10-23
tags:
  - architecture
  - ingestion
visibility: private
---

# Event Ingestion Architecture

This design builds upon [[MON-ADR-20261023-01K8F7X9P1]].
```

Preserve unknown frontmatter fields whenever possible.

Avoid destructive reformatting of existing Markdown.

Do not introduce a database as the authoritative store of note content.

## 6. Indexing

Use SQLite as a derived, rebuildable index.

The index should support:

- Note discovery.
- Title and alias lookup.
- Full-text search.
- Date bindings.
- Outgoing references.
- Backlinks.
- Vault ownership.
- Basic metadata filtering.

Requirements:

- Rebuildable from Markdown.
- Incremental updates where practical.
- No mandatory background daemon.
- File watching while the TUI is active.
- CLI operations must work without a running TUI.

For composite scopes, prefer federating independent vault indexes initially.

Avoid introducing a mandatory global database.

## 7. TUI — v0.1

Build the TUI using Ink and React.

The TUI must support the following workflows.

### Navigation

- Browse notes.
- Search notes.
- Display Markdown content.
- Navigate using a calendar.
- View note metadata.
- Follow internal references.
- View backlinks.
- Navigate between notes and return to previous locations.

### Editing

Neovim is the external editor.

The TUI should launch the configured editor when the user chooses to edit a note.

Do not build a general-purpose text editor inside the TUI.

### Reference Picker

Users must be able to:

1. Open a note.
2. Invoke the reference picker.
3. Search notes available within the active scope.
4. Select a target.
5. Insert a canonical reference into the current note.

The picker should display note titles and owning vaults.

### Structured Reference Insertion

Support inserting references:

- At the end of a note.
- Under an existing Markdown heading.
- Into a References section.

Use Markdown-aware parsing to identify insertion locations.

### Visual Text Selection

The note viewer must support keyboard-driven text selection.

Suggested controls:

- `v`: Begin selection.
- Vim-style motions or arrow keys: Extend selection.
- `r`: Create an internal reference.
- `l`: Create an external link.
- `Esc`: Cancel selection.

Selected text becomes the display label.

Example:

Before:

```markdown
Our architecture uses an asynchronous ingestion pipeline.
```

After selecting "asynchronous ingestion pipeline":

```markdown
Our architecture uses an
[[MON-ADR-20261023-01K8F7X9P2|asynchronous ingestion pipeline]].
```

For v0.1, selections may be restricted to contiguous source ranges within a single Markdown text block.

Do not allow transformations that would corrupt Markdown structures.

The selection mechanism must map rendered text back to source offsets safely.

### External Links

Support creating standard Markdown hyperlinks:

```markdown
[PostgreSQL Documentation](https://www.postgresql.org/docs/)
```

External URLs must not be treated as note identities.

### Safe Mutations

Before modifying an existing note:

- Validate the source note.
- Validate the target.
- Read the latest file state.
- Detect concurrent modifications.
- Preserve unrelated content and metadata.
- Apply the smallest possible edit.
- Refresh derived indexes.

Do not overwrite unsaved or concurrently modified content.

## 8. CLI — v0.1

The CLI must expose the same application capabilities as the TUI.

Design commands to be:

- Composable.
- Scriptable.
- Noninteractive when requested.
- Suitable for AI agents.
- Predictable.
- Explicit about errors.

Proposed command surface:

```bash
notes init

notes list
notes show <id>
notes search <query>

notes create --template <name> --title <title>
notes edit <id>

notes bind <id> --date <date>

notes reference create --target <id>
notes reference add --source <id> --target <id>
notes backlinks <id>

notes snippet insert <id> --snippet <name>

notes history <id>
notes diff <id>

notes export --format markdown --output ./dist
notes export --format html --output ./dist

notes index rebuild
notes doctor
notes capabilities --json
```

Treat this command surface as a proposal to refine during specification, not as an immutable API.

Support:

- `--json` where appropriate.
- Meaningful exit codes.
- Explicit scope selection.
- Noninteractive execution.
- Dry-run previews for mutations where useful.

Agents must not need to simulate terminal keystrokes to perform application operations.

## 9. Templates and Snippets

Store vault-specific templates and snippets in:

```text
.notes/templates/
.notes/snippets/
```

Templates create notes.

Snippets extend existing notes.

Support reusable variables such as:

```text
{{title}}
{{date}}
{{id}}
{{vault}}
```

Validate required variables.

Prevent path traversal and unintended overwrites.

Structured insertion operations should be reusable by the TUI, CLI, and agents.

## 10. Git and Revision History

Git is the initial revision backend.

Support:

- Listing historical note revisions.
- Viewing historical note content.
- Comparing revisions.
- Showing changes to a note over time.

A note revision is not necessarily equivalent to a Git commit.

Do not automatically commit unrelated project files.

Do not require every vault to have its own Git repository.

Gracefully handle vaults that are not under Git version control.

## 11. Publishing and Export

Implement a publishing pipeline independent of the TUI.

For v0.1, support exporting to:

- Markdown with transformed internal references.
- HTML with transformed internal references.

Publishing must preserve the source notes.

### Reference Transformation

Example source:

```markdown
[[MON-ADR-20261023-01K8F7X9P2|Event Ingestion Architecture]]
```

Markdown output:

```markdown
[Event Ingestion Architecture](./event-ingestion.md)
```

HTML output:

```html
<a href="/architecture/event-ingestion/"> Event Ingestion Architecture </a>
```

Routes should be configurable.

### Content Selection

Support explicit publication boundaries.

Examples:

- Selected vaults.
- Include and exclude patterns.
- Visibility metadata.

Private notes must not be published accidentally.

References to excluded or unavailable notes must follow an explicit policy.

Default to failing safely rather than exposing unintended content.

Validate generated route collisions.

### Scope of Publishing

The application is responsible for content selection, transformation, and export.

It is not responsible for building a complete website framework.

Generated content should be consumable by tools such as Astro or other static site generators.

Deployment automation is outside v0.1.

## 12. Application Architecture

Organize the application around domain capabilities rather than interface-specific implementations.

Suggested structure:

```text
src/
├── domain/
│   ├── vault/
│   ├── scope/
│   ├── note/
│   ├── identity/
│   ├── reference/
│   ├── calendar/
│   ├── revision/
│   └── publishing/
│
├── application/
│   ├── vault/
│   ├── notes/
│   ├── references/
│   ├── search/
│   ├── calendar/
│   ├── history/
│   └── export/
│
├── infrastructure/
│   ├── filesystem/
│   ├── markdown/
│   ├── sqlite/
│   ├── git/
│   └── identity/
│
└── interfaces/
    ├── cli/
    └── tui/
```

This is an initial organizational proposal.

Refine it if a simpler structure provides clearer boundaries.

Prefer vertical modules where appropriate.

Do not create interfaces or abstractions without a concrete use case.

## 13. Testing Strategy

Use Vitest.

Prioritize testing domain invariants and application behavior independently of infrastructure.

Include:

### Domain tests

- Identity uniqueness and immutability.
- Alias resolution.
- Scope behavior.
- Reference semantics.
- Date binding behavior.

### Application tests

- Note creation.
- Reference insertion.
- Text selection transformations.
- Template rendering.
- Snippet insertion.
- Export transformations.

### Infrastructure tests

- Markdown parsing and serialization.
- Frontmatter preservation.
- SQLite index rebuilding.
- Git revision retrieval.
- Filesystem discovery.
- Concurrent modification detection.

### Integration tests

- Initialize a vault.
- Create notes.
- Link notes.
- Search and navigate references.
- Export content.
- Verify generated links.

Use temporary directories and representative Markdown fixtures.

## 14. Non-Goals for v0.1

Do not implement:

- A dedicated Neovim plugin.
- A graphical desktop application.
- Cloud synchronization.
- User accounts or hosted authentication.
- Collaborative real-time editing.
- A mandatory background service.
- A custom graph database.
- Semantic/vector search.
- AI model integration.
- A complete static site generator.
- Deployment automation.
- A visual graph editor.
- Complex typed semantic relations.
- Rich text editing inside the TUI.

Keep the architecture extensible without implementing these features prematurely.

## 15. Development Principles

Follow these rules:

1. Markdown remains authoritative.
2. Identity is permanent; naming is flexible.
3. Vaults are independent and portable.
4. Scope controls operational visibility.
5. References are semantic; links are representations.
6. The domain is independent of storage and interfaces.
7. CLI and TUI share application services.
8. Structured edits must preserve source integrity.
9. Derived state must be rebuildable.
10. Publishing must enforce explicit content boundaries.
11. Prefer simple implementations over speculative abstractions.
12. Tests should verify behavior and invariants, not implementation details.

## 16. Initial Assignment

Do not immediately implement the complete application.

Start by producing a technical design proposal.

### Phase 1 — Architecture

Define:

1. The bounded contexts or domain modules.
2. Core entities and value objects.
3. Domain invariants.
4. Application use cases.
5. Ports and adapters.
6. Persistence contracts.
7. Reference parsing and resolution contracts.
8. Safe Markdown mutation strategy.
9. CLI command structure.
10. TUI navigation and interaction model.
11. Publishing pipeline.
12. Testing boundaries.

Identify ambiguities, risks, and architectural decisions that require clarification.

Do not invent product requirements beyond this specification.

### Phase 2 — Implementation Plan

Break v0.1 into small, independently testable milestones.

For each milestone, provide:

- Objective.
- Deliverables.
- Dependencies.
- Acceptance criteria.
- Tests.
- Definition of done.

Prefer vertical slices that demonstrate working behavior end to end.

### Phase 3 — Project Bootstrap

After the architecture and implementation plan are approved:

1. Initialize the TypeScript project.
2. Configure linting, formatting, and testing.
3. Establish module boundaries.
4. Implement the minimum domain contracts.
5. Implement the first working vertical slice.
6. Verify it through automated tests.

Avoid generating large amounts of placeholder code.

### Expected First Response

Begin by presenting:

1. A concise architectural overview.
2. A proposed domain model.
3. The most important architectural decisions.
4. Potential ambiguities or contradictions in the specification.
5. A recommended v0.1 milestone sequence.

Ask for approval before beginning implementation.

The objective is to build a reliable foundation that can evolve into a sophisticated knowledge management system without compromising portability, simplicity, or domain integrity.
