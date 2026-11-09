# Plan — Declared destination options & multi-collection themes

Status: implemented (2026-11-08) · [ADR 0007](../decisions/0007-destination-options.md) · follows [0006](../decisions/0006-publishing-destinations.md) · post-M8 enhancement

## Context

Two gaps surfaced while publishing to Astro:

1. **Destination options are hand-parsed and undiscoverable.** Each destination validates its
   `options` with a bespoke `settings()` function (`astro.ts` `parse`, `destinations/layout.ts`
   for markdown/html). Nothing lists what options a kind accepts; an agent or user has to read the
   source. Errors are inconsistent, and `capabilities` reports kinds but not their options.

2. **A theme exposes only one collection.** The `modular` profile declares `collections: { posts }`
   only, so notes can go to `/posts/` but not to the theme's `pages`, `docs` or `projects`
   collections (all defined in its `src/content.config.ts`). The `collection` option already exists
   on the astro destination (`destination: { kind: astro, theme: modular, collection: posts }`);
   it just has nothing but `posts` to choose from.

Routing stays **one publication per collection** (agreed): a publication selects a disjoint set of
notes and writes them to one collection; a second publication handles another collection. No
per-note `type → collection` fan-out — selection already differentiates, and keeping one fixed
route per publication keeps the plan simple.

The improvement is to make a destination **declare its options as data** — the publishing analogue
of how a plugin declares `fields: FieldSpec[]` — so the core validates them generically, surfaces
them in `capabilities`, and gives uniform errors. This is squarely in the "destinations are
plugin-like modules" line of ADR 0006.

## Guiding principle

**The publisher declares the schema; the core only knows the contract.** The core never
enumerates collections, options or theme fields — it defines the _shapes_ (`OptionSpec`,
`AstroTheme`/`AstroCollection`, the existing `FieldSpec`) and consumes whatever a destination or
theme declares: it validates config against the declaration, lists it in `capabilities`, and
checks it in `doctor`. A destination author (including a plugin) picks their own options; a theme
author picks their own collections, routes and frontmatter mappings — without the core changing.
`modular`'s four collections are an instance of this, not a built-in concept.

## Decisions

- **`OptionSpec` is a new, small type** (not reused `FieldSpec` — different semantics: config
  values, not note frontmatter; no `required`-per-owned-type, no `reference`/`date`/`list`).
- **`Destination.options(chosen?)` replaces `settings?()`, which is removed entirely.** It returns
  the option schema, and may use the options chosen so far to resolve a dependent enum (astro's
  `collection` values depend on the chosen `theme`). A single generic validator consumes the
  schema; no destination hand-parses options any more, and there is no bespoke escape hatch — a
  destination whose config a flat spec cannot express is a reason to revisit the spec, not to add
  one-off validation back.
- **Generic validation** (`validateOptions`) lives in `application/publishing`: reject unknown
  keys, apply defaults, check enum membership and scalar types, return the normalized options
  object. It runs in `resolve-publications` where `settings()` ran.
- **The theme profile becomes multi-collection.** `AstroTheme.collections[name]` grows from
  `{ route }` to `{ route, fields, frontmatter }`, so each collection owns its URL shape, its
  doctor-checked source fields, and its core→theme frontmatter mapping (a page has no `date`/`tags`;
  docs have `category`/`order`; projects have `repositoryUrl`/`status`). `modular` exposes **every
  user-facing collection it defines — `posts`, `pages`, `projects`, `docs`.** Its fifth collection,
  `special` (the theme's fixed-URL home blurb / 404 / section indexes), is theme-internal and not
  exposed as a publish target.
- **Astro themes are pluggable.** The astro destination stops owning a closed `THEMES` map; it
  becomes a factory `createAstroDestination(themes)`. The registry aggregates `AstroTheme`s from
  the built-in (`modular`) plus every enabled plugin that contributes one, and constructs the astro
  destination per vault — the same shape by which it already aggregates plugin `destinations`. A
  theme publisher ships a plugin whose `astroThemes` declares an `AstroTheme`, and
  `{ kind: astro, theme: <their-theme> }` just works, with no change to core. Theme-name clashes
  (two plugins, or a plugin shadowing `modular`) are rejected at registry build, exactly like
  destination-kind and panel-chord clashes.

## Approach

### 1. Contract — `application/publishing/destination.ts`

```ts
export interface OptionSpec {
  readonly name: string;
  readonly type: 'string' | 'boolean' | 'enum';
  readonly values?: readonly string[]; // enum members
  readonly default?: string | boolean;
  readonly required?: boolean; // no default and must be set
  readonly description?: string;
}

export interface Destination {
  readonly kind: string;
  readonly description: string;
  /** The options this kind accepts; `chosen` lets a dependent enum resolve (astro: collection by theme). */
  options(chosen?: Readonly<Record<string, unknown>>): readonly OptionSpec[];
  fields(options: unknown): readonly FieldSpec[];
  fixedRoute?(options: unknown): string | undefined;
  manifestPath?(options: unknown): string;
  pathFor(entry: PlanEntry, options: unknown): string;
  linkTo(from: Located, to: Located, options: unknown): string;
  render(input: RenderInput, tools: RenderTools, options: unknown): Result<string, AppError>;
}
```

`settings?()` is removed from the contract.

**Theme contract (public).** `AstroTheme` and `AstroCollection` move to exported types — they are
the theme author's contract — and the astro destination becomes a factory:

```ts
export const createAstroDestination = (themes: readonly AstroTheme[]): Destination;
```

It closes over the theme set; `options(chosen)` lists `themes.map(t => t.name)` as the `theme`
enum. The built-in export is `createAstroDestination([modularTheme])`.

**Plugin slot.** `NotePlugin` gains `astroThemes?: readonly AstroTheme[]` (narrow and typed —
astro is a first-party built-in, so the core already knows it; this only lets a third party
_extend_ it). A theme publisher ships a plugin that declares a theme; nothing else in the plugin
contract changes.

### 2. Generic validation — `application/publishing/validate-options.ts` (new)

```ts
export const validateOptions = (
  destination: Destination,
  raw: unknown,
): Result<Record<string, unknown>, AppError>;
```

- Coerce `raw` (`undefined`/`null` → `{}`); non-object → `validation`.
- `specs = destination.options(raw as Record)` — one call; the destination resolves dependent
  enums from `raw` (e.g. astro reads `raw.theme ?? 'modular'` to list collections).
- Unknown key (not named by any spec) → `validation` naming it and the accepted option names.
- Per spec: `value = raw[name] ?? default`; `required` && undefined → `validation`; `enum` &&
  value ∉ `values` → `validation` listing `values`; `string`/`boolean` type mismatch → `validation`.
- Return the normalized record (defaults applied) — this becomes `ResolvedPublication.options`.

Pure, hand-rolled (application can't import zod), unit-tested in isolation.

### 3. `resolve-publications.ts`

Replace the `destination.settings ? … : ok(options)` block with `validateOptions(destination,
publication.destination.options)`. Error message keeps naming vault + publication + kind. `fixedRoute`
reconciliation is unchanged (now reads the chosen collection's route).

### 4. Built-in destinations

- **`markdown.ts` / `html.ts`**: delete the bespoke `destinations/layout.ts` parser; declare
  ```ts
  options: () => [{ name: 'layout', type: 'enum', values: ['flat', 'directory'],
                    default: '<flat|directory>', description: 'file layout' }],
  ```
  `pathFor` reads the already-validated `options.layout`.
- **`astro.ts`**: drop `parse`; declare
  ```ts
  options: (chosen) => {
    const theme = THEMES[String(chosen?.theme ?? 'modular')];           // for the collection enum
    return [
      { name: 'theme', type: 'enum', values: Object.keys(THEMES), default: 'modular' },
      { name: 'collection', type: 'enum',
        values: theme ? Object.keys(theme.collections) : ['posts'], default: 'posts' },
    ];
  },
  ```
  `fields(options)` → the chosen collection's `fields`; `fixedRoute` → the collection's `route`;
  `pathFor` → `<contentDir>/<collection>/<slug>.md`; `render` → the collection's `frontmatter`
  mapping. Reading options now assumes they are already validated (normalized record), so the
  internal `options(raw)` cast helper stays but no longer re-validates.

### 5. Theme profile — `astro-themes/modular.ts`

```ts
export interface AstroCollection {
  readonly route: string;
  readonly fields: readonly FieldSpec[];
  frontmatter(entry: PlanEntry, source: Record<string, unknown>): Record<string, unknown>;
}
export interface AstroTheme {
  readonly name: string;
  readonly contentDir: string;
  readonly collections: Readonly<Record<string, AstroCollection>>;
}
```

Expose all four user-facing collections, each mapping core metadata onto that collection's schema
(from the theme's `src/content.config.ts`). Routes must be confirmed against the theme's `src/pages/`
during implementation; expected shapes below.

- **`posts`** — route `/posts/{{slug}}/`. Today's fields + `frontmatter()` move here verbatim
  (`description`, `date`←`created`, `tags`, `draft`, `image*`, `hideTOC`/`showTOC`, `targetKeyword`,
  `author`, `noIndex`).
- **`pages`** — route `/{{slug}}/` (root). Fields: `description`, `image`, `imageAlt`,
  `hideCoverImage`, `hideTOC`, `showTOC`, `noIndex`, plus `lastModified`←`created`. No `date`/`tags`.
- **`projects`** — route `/projects/{{slug}}/`. Fields: `description`, `date`←`created`,
  `categories`, `repositoryUrl`, `projectUrl`, `demoUrl`, `status`, `image*`, `featured`, `noIndex`.
- **`docs`** — route `/docs/{{slug}}/`. Fields: `description`, `category`, `order`,
  `lastModified`←`created`, `version`, `image*`, `noIndex`.

`special` is excluded (fixed URLs + theme logic). A different theme is a new profile file with its
own `collections` map — the destination code is unchanged.

### 6. Discovery & errors

- **`capabilities.ts`**: for each built-in (and plugin) destination, list
  `options()` → `[{ name, type, values?, default?, description? }]`. Agents then see every option
  without the source.
- **`doctor`**: no new finding kind; the better config errors come free from `validateOptions`
  at registry build (a broken `collection` blocks vault open with a listing, as today).

### 7. Registry — aggregate destinations _and_ astro themes

`buildRegistry` already validates destination-kind ownership and calls `resolvePublications`; it
gains the parallel for themes. In `destinationsFor(root)`:

```ts
const themes = [modularTheme, ...enabledHere(root).flatMap((p) => p.astroThemes ?? [])];
return [
  markdownDestination,
  htmlDestination,
  createAstroDestination(themes),
  ...enabledHere(root).flatMap((p) => p.destinations ?? []),
];
```

At build time, validate once (like the destination-kind and chord clashes): a theme name declared
by two enabled plugins, or shadowing `modular`, → `validation` naming both. The astro destination
is thus constructed per vault from that vault's available themes, so the `theme` enum a publication
validates against is exactly what that vault can use. `options.destinations` (test override) still
replaces the whole base set. Everything else (generic option validation, `resolvePublications`)
is unchanged; plugin destinations and plugin themes both flow through the same aggregation.

`builtinDestinations` stays exported as `[markdown, html, createAstroDestination([modularTheme])]`
for `capabilities` and the base set.

## Files

New: `src/application/publishing/validate-options.ts` (+test); a fixture plugin that contributes an
`astroThemes` theme for the theme-pluggability tests.
Modified: `destination.ts` (OptionSpec, contract, `settings` gone), `resolve-publications.ts`
(call `validateOptions`), `destinations/{markdown,html}.ts` (declare `options`, drop the bespoke
parser), remove `destinations/layout.ts`, `destinations/astro.ts` (`createAstroDestination`
factory, export `AstroTheme`/`AstroCollection`, declare `options(chosen)`, per-collection
`fields`/`fixedRoute`/`render`), `destinations/astro-themes/modular.ts` (four collections),
`destinations/index.ts` (`builtinDestinations` via the factory),
`application/plugin/plugin.ts` (`NotePlugin.astroThemes`), `application/plugin/registry.ts`
(theme aggregation + clash check), `interfaces/cli/commands/capabilities.ts`,
`docs/architecture.md` §7, `docs/plugins.md` (destination options + astro themes),
new ADR `0007-destination-options.md`.
Tests touched: `publish.test.ts`, `check-publications.test.ts`, `registry.test.ts` (the inline
`dest()` fake gains `options: () => []`; add theme-contribution + clash cases),
`integration/publish.test.ts` (add `pages`/`projects` publications).

## Tests

- **validate-options**: unknown key rejected (names accepted ones); default applied; enum reject
  lists values; boolean/string type reject; dependent enum — astro `collection` validates against
  the chosen `theme`'s collections, and against the default theme's when `theme` is omitted.
- **astro multi-collection**: a `pages` publication writes `src/content/pages/<slug>.md` with
  page frontmatter (no `date`/`tags`), route `/<slug>/`; a `posts` publication is unchanged;
  an unknown `collection` → 6 at registry build, listing the theme's collections.
- **markdown/html**: `layout` still validates (bad value → 6) through the new path; output
  unchanged.
- **capabilities**: the JSON lists each destination's options with values/defaults.
- **pluggable themes**: a fixture plugin contributing an `astroThemes` theme makes
  `{ kind: astro, theme: <plugin-theme> }` resolve and publish for a vault that enables it, and not
  for one that does not; two plugins declaring the same theme name, or a plugin shadowing `modular`,
  are rejected at `buildRegistry` naming both (same shape as the destination-kind clash test).
- **integration**: two astro publications in one vault (`blog` → posts, `pages` → pages) build
  into the same project and both appear; `ofl publish` lists both.

## Verification

`bun run check` (lint, format, typecheck, vitest). By hand in a scratch vault: a `pages`
publication alongside `blog`, `ofl capabilities --json` shows the `theme`/`collection`/`layout`
options, a bogus `collection: nope` fails at open naming the valid collections.

## Decisions settled (2026-11-08)

1. **Expose every user-facing collection** `modular` defines — `posts`, `pages`, `projects`,
   `docs` — so publishing is open to any of the theme's record kinds (`special` stays internal).
2. **Remove `settings?()` entirely**; `options(chosen)` plus the generic validator is the only path.
3. **Astro themes are pluggable** (option B): `createAstroDestination(themes)` + a
   `NotePlugin.astroThemes` slot + registry theme-aggregation, so theme publishers extend astro
   without touching core — the same flexibility destination authors already have.
4. **Record the design in a new ADR `0007-destination-options.md`** (covers both the declared
   option spec and pluggable themes).
