# 0006 — Publishing: destinations, and the two-layer exposure model

Date: 2026-11-07 · Status: accepted (implemented, M8)

## Context

Publishing was the last MVP feature. It had a design since v0.1 (`architecture.md` §7, `plan.md`
M8) but no code: no `domain/publishing`, no publishing use cases, no `publications:` key in the
config schema (zod silently dropped it), and no HTML anywhere. The written design assumed a single
`export` that chose a `--format md|html`. Two things pushed past that before building it.

First, the system should publish to real static-site generators, not just dump fragments. Astro in
particular is SEO-ready out of the box (sitemap, RSS, OG images, `noIndex`, meta description), and
a concrete target theme exists ([astro-modular](https://github.com/davidvkimball/astro-modular)).
A format flag cannot carry what an SSG needs — a content directory, a collection's URL shape, a
frontmatter schema.

Second, "which notes get published" was underspecified. The old invariant 9 said a plan excludes
non-public notes "unless an explicit include matches it", which lets a glob override a note's own
`private`. That is a footgun: a broad `include` would publish secrets.

## Decision

### Named publications with a destination

A **publication** is a named entry under `publications:` in `.ofl/config.yaml`: a selection
(include/exclude globs), a route template, a reference policy, an output directory, and a
**destination**. No ad-hoc `--format/--output` flags; the CLI verb is `publish [<name>]`
(ADR 0005), and a bare `publish` lists them.

### Destinations are plugin-like modules

A destination is a code contract (`application/publishing/destination.ts`): `pathFor`, `linkTo`,
`render`, plus `settings` (validate options), `fields` (declared source fields), `fixedRoute`, and
`manifestPath`. Built-in kinds are parameterised by declarative options in config; a plugin may
register more. Three decisions shape this:

- **The plan is destination-agnostic.** `planPublication` (pure, domain) decides selection, routes,
  collisions and reference classification. The destination only renders and lays out files. So the
  hard logic is tested once, independently of any format.
- **Built-ins live inside the registry.** The TUI builds the registry too; host-supplied built-ins
  would desync the two interfaces. `buildRegistry` owns `builtinDestinations` and validates that a
  kind belongs to the core or exactly one plugin — the same single-owner rule as types and chords.
- **A destination reaches the system only through `RenderTools`** (`toHtml`, `updateFrontmatter`),
  never `AppDeps` — the publishing analogue of `PluginApi`. It cannot read or write files; the
  orchestrator does that.

Like a plugin, a destination **declares `FieldSpec`s** — frontmatter fields it reads from the
_source_ note. `doctor` validates them on the notes a publication selects (dropping `undeclared`),
so a post missing the theme's required `description` is caught before publish, not silently
defaulted by the SSG.

### Validation is split by when it can be known

- **Shape** (is `references` a known policy, is `output` a string) → config load, in zod.
- **Kind and options** (is `astro` a real kind, is `theme: nope` valid) → registry build, by the
  destination's `settings`. A broken `publications:` block therefore blocks the vault from opening,
  exactly as invalid plugin settings do — consistent, fail-fast, and it blocks the TUI the same way.
- **Per-note fields** (does this selected post have a `description`) → `doctor`, a pre-flight.

### `astro` is a kind; a `theme` is a profile

`destination: { kind: astro, theme: modular }`. The kind is thin; a **theme profile** owns the
real contract — content directory, the collection's route (`/posts/{{slug}}/`), and the mapping
from an entry's core metadata onto the theme's frontmatter. The publication's `output` points at
the Astro project root; the manifest lands at `.capture/manifest.json`, hidden and outside the
theme's `src/content` vault. A further theme is a new profile file, not a new kind.

### Two layers of exposure

The user's model, replacing invariant 9's override clause:

- **Note layer = eligibility.** `visibility: public` means any publication _may_ use the note;
  `private` (the default, A3) means none can. There is **no publication-level override of private**.
- **Publication layer = selection.** Each publication's globs choose among the eligible notes. A
  glob can never admit a private note; selection checks visibility first. Dry-run distinguishes the
  reasons `private` (note layer) from `not included` / `excluded by <glob>` (publication layer).

Because this is the eligibility gate, the TUI now **shows a visibility badge** (a list column and
the note-view header), so one never publishes blind. Configuring publications from the TUI is the
post-MVP end state; for the MVP the badge is the whole TUI surface.

### Output anchoring and the self-ingest guard

`output` is relative to the defining vault's root (or absolute). If the output lands inside that
vault where the vault's globs would index it, the next refresh would ingest the published copies as
duplicate-id notes — so `planPublication` refuses, pointing at the vault's `exclude`.

## Consequences

- New `domain/publishing` (pure: publication, route, output-path, select, classify, collisions,
  plan, manifest) and `application/publishing` (destination contract, three built-ins + the
  `modular` theme, resolve/candidates/plan/rewrite/execute/publish/check). New `OutputStore` port
  and a GFM→HTML adapter (`remark-rehype` + `rehype-stringify`). The `publish` CLI command and the
  TUI badge.
- The old config example (`format`, `/{slug}/`, `unresolved`) no longer validates; the docs changed
  in the same change. Frontmatter on disk is unaffected.
- **Deliberately deferred:** more astro themes and collections (`pages`/`projects`/`docs`),
  declarative custom themes, cover-image copying, `--clean` for stale outputs, type/tag selectors,
  copying destination-declared fields (e.g. html `description`) into the manifest, and a golden-file
  test harness (the integration tests cover all three destinations end-to-end instead).
