# 0007 — Declared destination options and pluggable Astro themes

Date: 2026-11-08 · Status: accepted (implemented) · follows [0006](./0006-publishing-destinations.md)

## Context

[0006](./0006-publishing-destinations.md) shipped destinations as plugin-like modules: a code
contract, built-in kinds (`markdown`, `html`, `astro`) parameterised by `options` in config, and a
door for plugins to add kinds. Two gaps surfaced the first time we published a real Astro site.

**Options were hand-parsed and undiscoverable.** Each destination validated its `options` with a
bespoke function — `markdown`/`html` shared a `parseLayoutOptions`, `astro` had its own `parse`
rejecting unknown themes and collections. Nothing listed what a kind accepts; an agent or a person
had to read the source. Errors were phrased per destination, and `capabilities` reported kinds but
not their options.

**A theme exposed only one collection.** The `modular` profile declared `collections: { posts }`,
so a note could go to `/posts/` but not to the theme's `pages`, `projects` or `docs` collections,
all defined in its `src/content.config.ts`. The `collection` option already existed; it just had
nothing but `posts` to choose from. And a theme lived in a closed `THEMES` map inside the astro
destination, so a third party could not add one without editing core — unlike destination _kinds_,
which plugins can already contribute.

Both gaps are the same shape: the core was enumerating things the publisher should own.

## Decision

**The publisher declares the schema; the core only knows the contract.** The core defines the
_shapes_ and consumes whatever a destination or theme declares — it validates config against the
declaration, lists it in `capabilities`, and checks it in `doctor`. It never enumerates a
destination's options, a theme's collections or a collection's fields.

1. **Destinations declare options as data.** A new `OptionSpec`
   (`{ name, type: 'string' | 'boolean' | 'enum', values?, default?, required?, description? }`) is
   the publishing analogue of a plugin's `FieldSpec`. `Destination.options(chosen?)` returns the
   schema; `chosen` lets a dependent enum resolve (astro's `collection` values follow the chosen
   `theme`). A single generic validator, `validateOptions`, consumes it: reject a non-mapping,
   reject unknown keys (naming the accepted ones), apply defaults, enforce `required`, check enum
   membership and scalar types, return the normalized record. It runs in `resolvePublications`,
   where the per-destination `settings()` used to run.

2. **`settings?()` is removed entirely.** There is no bespoke escape hatch. A destination whose
   config a flat scalar/enum spec cannot express is a reason to revisit the spec, not to add
   one-off validation back. The destination reads the already-normalized options and never
   re-validates.

3. **A theme is multi-collection, and the theme is the contract.** `AstroCollection` grows to
   `{ route, fields, frontmatter }`, so each collection owns its URL shape, its doctor-checked
   source fields and its core→theme frontmatter mapping (a page has no `date`/`tags`; docs carry
   `category`/`order`; projects carry `repositoryUrl`/`status`). `modular` exposes every
   user-facing collection it defines — `posts`, `pages`, `projects`, `docs`. Its `special`
   collection (fixed-URL home blurb / 404 / section indexes) is theme-internal and not a target.

4. **Astro themes are pluggable.** The astro destination stops owning a closed `THEMES` map and
   becomes a factory `createAstroDestination(themes)`. The registry aggregates the built-in
   `modular` with every `AstroTheme` an enabled plugin contributes via a new
   `NotePlugin.astroThemes` slot, and builds the astro kind per vault from that vault's available
   themes — the same aggregation it already does for plugin `destinations`. Theme names are
   single-owner: a plugin shadowing `modular`, or two plugins declaring one name, are rejected at
   registry build, exactly like destination-kind and panel-chord clashes.

Routing stays **one publication per collection**: a publication selects a disjoint set of notes and
writes them to one collection; a second collection is a second publication. No per-note
`type → collection` fan-out — selection already differentiates, and one fixed route per publication
keeps the plan simple.

## Consequences

- One validation path for all destination options, with uniform errors, and `capabilities --json`
  now lists each destination's options (name, type, values, default). An agent configures a
  publication without reading source.
- Publishing to any of the theme's record kinds works today; a bogus `collection` fails at vault
  open, listing the valid ones (the better error comes free from `validateOptions`).
- A theme author ships a plugin declaring an `AstroTheme` and
  `{ kind: astro, theme: <theirs> }` just works — the same flexibility destination-kind authors
  already had, without touching core.
- As in 0006, a broken `publications:` block (now including a bad option or collection) fails
  `buildRegistry` and so blocks the vault from opening, consistent with invalid plugin settings.

## Alternatives considered

- **Keep `settings()` as an escape hatch alongside the spec.** Rejected: two code paths for the
  same job, and it would let a destination quietly reintroduce undiscoverable config. If the flat
  spec is too weak, widen the spec.
- **Reuse `FieldSpec` for options.** Rejected: different semantics (config values, not note
  frontmatter; no per-owned-type `required`, no `reference`/`date`/`list`). A small dedicated type
  is clearer than overloading one.
- **Themes stay in-repo (a new profile file per theme).** Rejected in favour of a plugin slot
  (option B), so the extension point for themes matches the one for kinds — a theme is just data
  plus pure functions, exactly what a plugin is built to carry.
- **Per-note `type → collection` fan-out in one publication.** Rejected: selection already splits
  notes, and a fixed route per publication keeps collisions and the plan simple.
