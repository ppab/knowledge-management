# Publish — M8 with destinations

Status: approved implementation plan (2026-11-07). Companions: [plan.md](../plan.md) § M8,
[architecture.md](../architecture.md) §7, ADR [0005](../decisions/0005-capture-entry-model.md)
(the `publish` verb); ADR 0006 (destinations) lands with the implementation.

## Context

Publishing is the last missing MVP feature. It has had a design since v0.1 (`docs/architecture.md`
§7, `docs/plan.md` M8) but no code: no `src/domain/publishing`, no `src/application/export`, no
`publications` key in the config schema (zod silently drops it today), and no HTML output anywhere.

Decisions taken in conversation (2026-11-07), on top of the written spec:

- **Verb is `publish`** (ADR 0005), not `export`. Publishing is CLI-only for the MVP, but the
  TUI **renders a visibility badge** (list column + note header) so eligibility is always visible;
  configuring publications from the TUI is the post-MVP end state.
- **Named publications from the start**, declared per vault under `publications:` in
  `.notes/config.yaml`. No ad-hoc `--format/--output` flags.
- **Destinations.** A publication = *selection* + *route template* + *reference policy* + a
  **destination**. The plan is pure and destination-agnostic; the destination only decides how to
  render and lay files out. Destinations are **plugin-like modules**: a code contract, built-in
  kinds parameterised by declarative options in config, and plugins may register new kinds.
  Like plugins, a destination **declares `FieldSpec`s** — frontmatter fields it reads from the
  *source* note — which `doctor` validates on the notes a publication selects.
- **Two layers of exposure.** *Note layer = eligibility:* `visibility: public` means any
  publication may use the note; `private` (the default, A3) means none can — there is **no
  publication-level override**. *Publication layer = selection:* each publication picks which
  eligible notes it wants (include/exclude globs) and how to emit them. Dry-run distinguishes the
  reasons `private` (note layer) from `not included` / `excluded by <glob>` (publication layer).
  This supersedes invariant 9's "unless an explicit include matches it" clause; the docs change.
- **MVP kinds: `markdown`** (full file, frontmatter kept verbatim, references → relative links),
  **`html`** (body fragments, A7), and **`astro`** — chosen because the target theme is SEO-ready
  (sitemap, RSS, OG images, `noIndex`, meta description). `astro` is the *kind*; a **`theme`
  option** selects a theme profile that defines the real contract (collection folder, URL prefix,
  frontmatter schema): `destination: { kind: astro, theme: modular }`. The MVP ships the
  `modular` profile ([astro-modular](https://github.com/davidvkimball/astro-modular), MIT,
  v1.1.11, schema read from `src/content.config.ts` on `master`); further themes are new profile
  files, not new kinds. **`manifest.json` is core** — every publication emits it.

Honours the M8 acceptance criteria: default-deny visibility, dry-run lists exclusions with
reasons, `fail` policy aborts with exit 6 naming source and target, `strip-to-label` / `keep-id`
as specified, collisions abort before any write, unlabeled references use the target's current
title, source files are never written (hashes unchanged).

## Approach

### 1. Domain — `src/domain/publishing/` (pure; relative imports only, no `node:*`)

- `publication.ts`
  ```ts
  export type ReferencePolicy = 'fail' | 'strip-to-label' | 'keep-id';
  export const REFERENCE_POLICIES: readonly ReferencePolicy[];
  export interface DestinationRef { readonly kind: string; readonly options: unknown }
  export interface Publication {
    readonly name: string;
    readonly destination: DestinationRef;
    readonly output: string;              // dir; relative to the defining vault's root, or absolute
    readonly route: string;               // `{{slug}}` template; default '/{{slug}}/'
    readonly include: readonly string[];  // vault-relative globs; [] = every eligible note
    readonly exclude: readonly string[];
    readonly vaults?: readonly string[];  // scope vault names to draw notes from; default: defining vault
    readonly references: ReferencePolicy; // default 'fail' (one policy for excluded + unresolved)
  }
  ```
- `route.ts` — `routeVariables(candidate)` → `{ slug (frontmatter slug ?? slugify(title)), id, type?, dir, stem }`;
  `renderRoute(template, vars)` = `renderTemplate` (`domain/template/render.ts`) + `normalizeRoute`
  (leading `/`, collapse `//`, reject `.`/`..`, percent-encode outside unreserved+`/`); a missing
  variable (`{{type}}` on a typeless note) is `validation` **naming the note**. `routeToPath(route,
  ext, layout: 'flat'|'directory')` → `a/b.md` | `a/b/index.html`; `/` → `index.<ext>`.
- `output-path.ts` — `relativePath(fromFile, toFile)` (POSIX string ops; `./x.md`, `../a/x.md`),
  `resolveOutputDir(root, output)` (lexical join, absolute passes through),
  `normalizeOutputPath(path)` (rejects `..`, empty, leading `/` — a hostile `slug:`),
  `escapeMarkdownText(text)` for titles used as link labels.
- `select.ts` — `PublicationCandidate { vault, path, id, title, slug?, type?, visibility, tags,
  dates, fields, version, references: Reference[] }` (built from `NoteSummary` +
  `index.outgoing(path)` — **no file reads**). `selectCandidates(publication, candidates,
  definingVault)` → `{ included, excluded: { candidate, reason }[] }` with
  `ExclusionReason = {kind:'vault'} | {kind:'private'} | {kind:'not-included'} | {kind:'excluded'; by}`.
  Order: vault → visibility (absolute) → include → exclude. Uses `matchesGlob` (`domain/vault/glob.ts`).
- `classify.ts` — `classifyReferences(included, existing: Map<id,{title}>, policy)` →
  `{ targets: Map<id, {state:'published'|'excluded'|'unresolved', title?}>, violations }`;
  violations only under `fail`, each `{ source:{vault,path,id}, target, state, range }`.
- `collisions.ts` — `findRouteCollisions(entries)` (exact **and case-insensitive**),
  `findPathCollisions(paths)`.
- `plan.ts` — `PlanEntry = PublicationCandidate & { route }`;
  `PublicationPlan { publication, vault, outputDir, entries (sorted by route), excluded, targets,
  violations, collisions }`; `buildPlan(publication, definingVault, outputDir, candidates,
  existing)`: `err` only when a route cannot render; `isPublishable(plan)` = no violations, no
  collisions.
- `manifest.ts` — `buildManifest(plan, paths)` → `{ publication, destination, entries: [{ id, title,
  route, path, dates, tags, source:{vault,path} }] }`; no timestamp (golden files stay deterministic).
- `src/domain/vault/vault.ts` — `VaultConfig.publications?: Readonly<Record<string, Publication>>`.

### 2. Ports and infrastructure

- `src/application/ports.ts` — `MarkdownParser.toHtml(markdown: string): string` (GFM → HTML
  fragment, no wrapper); new `OutputStore { write(dir, path, content): Promise<Result<void>> }`
  (absolute `dir`, relative POSIX `path`, mkdir -p, atomic temp+rename, `UNAVAILABLE` on failure);
  `AppDeps.outputs`.
- `src/infrastructure/markdown/html.ts` — `unified().use(remarkParse).use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeStringify, { allowDangerousHtml: true })`
  — raw HTML in notes passes through verbatim (no `rehype-raw`; fragments are for an SSG to embed).
  Spread into `createMarkdownParser` (`parser.ts`). New deps: `remark-rehype`, `rehype-stringify`.
- `src/infrastructure/filesystem/output-store.ts` — `createOutputStore()`: lexical containment of
  `path` within `dir` (reuse the `resolveInside` idea from `note-store.ts` minus the `.notes` rule),
  mkdir -p, temp file + `rename`. Wire in `src/infrastructure/deps.ts`.
- `src/infrastructure/config/vault-config.ts` — zod:
  `destination: z.union([z.string().min(1), z.looseObject({ kind: z.string().min(1) })])`
  (string shorthand → `{kind, options:{}}`; object → `kind` stripped, rest = options),
  `output: z.string().min(1)`, `route: ….default('/{{slug}}/')`, `include/exclude: z.array(…).default([])`,
  `vaults: z.array(…).min(1).optional()`, `references: z.enum(REFERENCE_POLICIES).default('fail')`;
  `publications: z.record(z.string().min(1), publicationSchema).optional()`; `toVaultConfigFile`
  round-trips it. (The old doc example — `format`, `/{slug}/`, `unresolved` — now fails validation;
  docs change in the same PR.)

### 3. Application — `src/application/publishing/`

- `destination.ts` — the contract (plugins may import application, so this is reachable by
  built-ins, plugins, registry, doctor and CLI without layer violations):
  ```ts
  export interface RenderTools {            // the publishing analogue of PluginApi: never AppDeps
    toHtml(markdown: string): string;
    updateFrontmatter(yaml: string, update: FrontmatterUpdate): Result<string, AppError>;
  }
  export interface Located { readonly entry: PlanEntry; readonly path: string }
  export interface RenderInput { entry: PlanEntry; path: string; frontmatterYaml: string; frontmatter: Record<string, unknown>; body: string /* refs rewritten */ }
  export interface Destination {
    readonly kind: string; readonly description: string;
    readonly settings?: (raw: unknown) => Result<unknown, AppError>;  // validates options; {} when none
    /** Frontmatter fields read from source notes; doctor-validated on selected notes. Depends on options (e.g. the astro theme). */
    fields(options: unknown): readonly FieldSpec[];
    /** A route template the output layout dictates (astro: '/posts/{{slug}}/'); a publication `route` that differs is a VALIDATION error at registry build. */
    fixedRoute?(options: unknown): string | undefined;
    /** Where `manifest.json` lands, relative to the output dir; default 'manifest.json'. */
    manifestPath?(options: unknown): string;
    pathFor(entry: PlanEntry, options: unknown): string;
    linkTo(from: Located, to: Located, options: unknown): string;
    render(input: RenderInput, tools: RenderTools, options: unknown): Result<string, AppError>;
  }
  export interface ResolvedPublication { vault: OpenVault; publication: Publication; destination: Destination; options: unknown }
  ```
  `FieldSpec` is a type-only import from `../plugin/plugin.js` (type-only cycle, erased).
- `destinations/markdown.ts` — options `{ layout?: 'flat'|'directory' }` (default `flat`,
  hand-written validator — application cannot import zod); `pathFor` = `routeToPath(route,'md',layout)`;
  `linkTo` = `relativePath(from.path, to.path)`; `render` = frontmatter verbatim
  (`wrapFrontmatter`) + body; `fields: []`.
  `destinations/html.ts` — options `{ layout }` default `directory`; `pathFor` →
  `routeToPath(route,'html',layout)`; `linkTo` = `to.entry.route`; `render` = `tools.toHtml(body)`;
  `fields: [{ name: 'description', type: 'string', description: 'summary for the manifest' }]`
  (exercises the declared-field path end to end; copied into the manifest when present).
  `destinations/astro.ts` + `destinations/astro-themes/modular.ts` — options
  `{ theme?: string (default 'modular'); collection?: string (default 'posts') }`; `settings()`
  rejects an unknown theme, listing the known ones. A **theme profile** is data + two functions:
  ```ts
  export interface AstroTheme {
    readonly name: string;
    readonly contentDir: string;                       // 'src/content'
    readonly collections: Readonly<Record<string, { route: string /* '/posts/{{slug}}/' */ }>>;
    readonly fields: readonly FieldSpec[];             // the theme's frontmatter schema, minus what core maps
    frontmatter(entry: PlanEntry, source: Record<string, unknown>): Record<string, unknown>;
  }
  ```
  `modular` (from `src/content.config.ts`, posts collection): `fields` =
  `description` (string, **required** — the theme silently defaults it to "No description
  provided", which is the SEO hole doctor should catch), `image`, `imageAlt` (string), `imageOG`,
  `hideCoverImage`, `hideTOC`, `showTOC`, `noIndex`, `draft` (boolean), `targetKeyword`, `author`
  (string). `frontmatter()` maps core → theme: `title` → `title`, `created` → `date` (`YYYY-MM-DD`;
  the theme falls back to *build time* when absent, so always emit it), `tags` → `tags`, every
  declared field passed through when present, plus `id` kept for traceability (unknown keys are
  stripped by the theme's zod, so it is harmless); `aliases`, `visibility`, `type`, `created` are
  not emitted. Output: `pathFor` = `<contentDir>/<collection>/<slug>.md` (filename stem is the
  theme's slug, so our `slug ?? slugify(title)` doubles as both filename and URL);
  `fixedRoute` = the collection's route; `linkTo` = `to.entry.route` (standard
  `[Label](/posts/slug/)` works for every collection; the theme's native wikilinks resolve by
  title, not by our ids, so we do not emit them); `render` = `tools.updateFrontmatter`-built YAML
  + body; `manifestPath` = `.capture/manifest.json` (hidden, outside the theme's `src/content`
  Obsidian vault). `output` in the publication points at the **Astro project root**. No new
  dependencies — astro is Markdown-based.
  `destinations/index.ts` — `builtinDestinations = [markdown, html, astro]`.
- `resolve-publications.ts` — `resolvePublications(scope, destinationsFor)` → every available
  vault's publications with destination resolved and options validated; `validation` names vault,
  publication, kind and lists known kinds. Applies `fixedRoute`: when the destination dictates a
  route and the publication sets a different one → `validation` ("theme modular fixes the route
  to /posts/{{slug}}/"); when the publication leaves `route` at its default, the fixed route wins.
- `candidates.ts` — `collectCandidates(session)` → `{ candidates, existing: Map<id,{title}> }`
  from `index.all().filter(isNoteSummary)` + `index.outgoing(path)` across `session.opened`.
- `plan-publication.ts` — `planPublication(session, resolved)`: candidates →
  `resolveOutputDir(vault.root, output)` → `buildPlan` → **guard**: refuse (`validation`) when the
  output dir lies inside the defining vault and `inclusionOf(config, …)` would index it (duplicate
  ids on the next refresh; "add it to `exclude`").
- `rewrite-references.ts` — `rewriteReferences(note, plan, destination, options, paths, from)` →
  body. `published` → `[label](linkTo)` with `label = ref.label ?? escapeMarkdownText(title)`;
  `excluded|unresolved` + `strip-to-label` → `ref.label ?? escapeMarkdownText(title ?? id)`;
  `keep-id` → untouched. A preceding `!` (Obsidian embed) is included in the edit and emitted as
  `\!`. Edits via `replaceRange`/`applyEdits` on the **full `note.source`** (ranges are absolute),
  then `.slice(note.body.start)`. Target missing from `plan.targets` → `conflict`.
- `execute-publication.ts` — `executePublication(deps, session, resolved, plan)`: `pathFor` each
  entry → `normalizeOutputPath` → `findPathCollisions` (`validation`, nothing written) → read each
  entry with `readNoteFile`, refuse on `note.version !== entry.version` (`conflict`) → rewrite →
  `render` → **collect everything in memory, then write** (`deps.outputs.write` per file +
  `manifest.json`), so a render failure also aborts before any write. Never deletes.
- `publish.ts` — `publish(deps, scope, registry, { name, dryRun? })` → `withScope` →
  `findPublication(registry.publications(), name)`: none → `notFound` (lists names; `unavailable`
  when `session.unavailable` is non-empty, A6); several → `ambiguous` naming vaults; a `vaults:`
  name outside the scope → `usage`. Plan; dry-run returns `ok` with the plan (CLI exits 6 when not
  publishable); real run returns `validation` with `details: { violations, collisions }` and a
  message naming source → target. `listPublications(registry)`.
- `check-publications.ts` — `publicationFindings(registry, opened)`: for each resolved publication
  whose vault is opened, select via the same `selectCandidates`, then `validateFields
  (destination.fields, summary.fields)` **dropping `undeclared`** → `kind:'publication'`,
  `severity:'warning'`, details `{ publication, destination, path, field, problem }`; then
  `buildPlan` and report collisions/violations as warnings ("publication site would not proceed:
  …"). `doctor` is a pre-flight; `publish` is the gate.

### 4. Plugin contract, registry, doctor

- `src/application/plugin/plugin.ts` — `NotePlugin.destinations?: readonly Destination[]`;
  `PluginRegistry.destinationsFor(root)` (built-ins + kinds of plugins that vault enables) and
  `PluginRegistry.publications(): readonly ResolvedPublication[]`.
- `src/application/plugin/registry.ts` — **built-ins live inside the registry** (the TUI calls
  `buildRegistry` too, `tui.tsx:36`; host-supplied built-ins would desync the two interfaces);
  `RegistryOptions.destinations?` overrides them for tests. Reject a kind declared by two enabled
  plugins or shadowing a built-in (`validation` naming both — same shape as the chord clash). Then
  `resolvePublications(scope, destinationsFor)`; a failure fails `buildRegistry` (fail-fast at vault
  open, exactly like invalid plugin `settings()`; a broken `publications:` therefore blocks the TUI
  as broken plugin settings do today — consistent, and said so in the ADR).
- `src/application/doctor/diagnose.ts` — `CoreFindingKind` += `'publication'`; in `diagnoseCore`
  after `fieldFindings`: `if (registry) findings.push(...publicationFindings(registry, opened))`.
  Update the `doctor` description in `commands/maintenance.ts`.

### 5. CLI

- New `src/interfaces/cli/commands/publish.ts` — `publish [name] [--dry-run]` ("print the
  publication plan and write nothing"). No name → `table` of publications (name, vault, kind,
  output, route) or "No publications defined in .notes/config.yaml". With name →
  `inScopeWithPlugins(ctx, (scope, registry) => publish(…))`; after `emit`, exit 6 when a dry-run
  plan is not publishable. Wire in `commands.ts`.
- `output.ts` — `publishText(outcome)`: header `publication: site (monitor, html) → <outputDir>`,
  `included (n):` rows `id  title  source  route  path`, `excluded (n):` with reason text
  (`private` / `not included` / `excluded by <glob>` / `other vault`), `violations (n):`
  `docs/a.md [[ID9]] → ID9 (excluded; policy fail)`, `collisions:`; real run `Wrote n files to
  <dir>` + list. JSON mirrors the outcome with `targets` projected to an array (Maps don't
  serialise).
- `capabilities.ts` — `describePlugin` adds `destinations`; top-level `destinations` lists the
  built-ins. Commands themselves are introspected from commander already.
- Exit codes: unknown publication 3; defined in two vaults 4; collisions / `fail` violations / bad
  kind or options / output-inside-include 6; vault unavailable / write failure 7; bad `vaults:` 2.

### 6. TUI — visibility badge (MVP; publishing itself stays CLI-only)

With the note layer as the eligibility gate, the TUI must show it or people publish blind. The
end state after the MVP is configuring publications from the TUI; for now, only the badge.

- `src/interfaces/tui/components/Rows.tsx` — generalise `roles` so an entry may be a per-cell
  resolver: `Role | null | ((cell: string) => Role | null)`. One-line change in the cell painter;
  existing callers are untouched.
- `src/interfaces/tui/screens/NoteList.tsx` — new column after `id`: header `visibility`, cell
  `public` / `private` (`'-'` for unidentified entries); role resolver paints `public` with `ok`
  (green) and `private` with `muted` — private is the unremarkable default-deny baseline, public is
  what you must notice.
- `src/interfaces/tui/screens/NoteView.tsx` — the header's right-hand `Frame` `meta` slot (unused
  in the note view today) shows the badge: `<Text {...theme.paint('ok')}>public</Text>` /
  `<Text {...theme.paint('muted')}>private</Text>`. The metadata panel's existing
  `visibility: …` line stays.
- Optional, cheap, not in scope unless wanted: `Space v` toggles visibility through the existing
  `setFields` mutation path, so "make this eligible" is one chord away from the badge.
- Tests (`test/tui/list.test.tsx`, `test/tui/references.test.tsx` pattern): the list shows
  `public` for a public note and `private` for a private one; the note view header shows the badge
  for each; the harness `waitFor` targets the badge text.

### 7. Docs

- `docs/architecture.md`: §1 tree (`domain/publishing`, `application/publishing`), §2
  `Publication` row, invariant 9 reworded to the two-layer rule, ports table (`OutputStore`,
  `toHtml`), config example (below), §5 synopsis `notes publish [<name>] [--dry-run]`, §7 rewritten
  around destinations, §8 integration row.
  ```yaml
  publications:
    site:
      destination: { kind: html, layout: directory }   # or shorthand: destination: markdown
      output: ./dist                                    # vault-relative or absolute
      route: '/{{slug}}/'                               # vars: slug, id, type, dir, stem
      include: ['docs/**']
      exclude: ['docs/drafts/**']
      references: fail                                  # fail | strip-to-label | keep-id
    blog:
      destination: { kind: astro, theme: modular }     # theme fixes route '/posts/{{slug}}/'
      output: ../my-site                                # the Astro project root
      include: ['posts/**']
      references: strip-to-label
  ```
- `docs/plan.md` M8 → "Publish" with a status line. `docs/plugins.md`: §2 note on destination
  fields (validated on *selected* notes, no `undeclared`), §3 `destinations?` slot, §7 candidate
  `astro` kind. `README.md`: short publish section.
- `docs/decisions/0006-publishing-destinations.md`: destinations as plugin-like modules; plan
  destination-agnostic; manifest core; built-ins inside the registry; validation split (shape →
  config load, kind/options → registry, fields → doctor); the two-layer exposure rule; output
  anchoring at the defining vault; raw HTML pass-through; `astro` as kind + theme profiles (why a
  theme, not a kind, owns the schema); deferred: more astro themes and other collections
  (`pages`/`projects`/`docs`), declarative custom themes, cover-image copying, `--clean` for stale
  outputs, type/tag selectors, read shortcuts.

## Files

New: `src/domain/publishing/{publication,route,output-path,select,classify,collisions,plan,manifest}.ts` (+tests);
`src/application/publishing/{destination,resolve-publications,candidates,plan-publication,rewrite-references,execute-publication,publish,check-publications}.ts`,
`destinations/{markdown,html,astro,index}.ts` and `destinations/astro-themes/modular.ts` (+tests); `src/infrastructure/markdown/html.ts`,
`src/infrastructure/filesystem/output-store.ts` (+tests); `src/interfaces/cli/commands/publish.ts`;
`test/fixtures/publish/` (golden vault + expected trees); `test/golden/publish.test.ts`;
`test/integration/publish.test.ts`; `docs/decisions/0006-publishing-destinations.md`.

Modified: `src/application/ports.ts`, `src/domain/vault/vault.ts`,
`src/infrastructure/config/vault-config.ts` (+test), `src/infrastructure/markdown/parser.ts`,
`src/infrastructure/deps.ts`, `src/application/plugin/{plugin,registry}.ts` (+test),
`src/application/doctor/diagnose.ts` (+test), `src/interfaces/cli/{commands.ts,output.ts}`,
`src/interfaces/cli/commands/{capabilities,maintenance}.ts`,
`src/interfaces/tui/components/Rows.tsx`, `src/interfaces/tui/screens/{NoteList,NoteView}.tsx`
(+ `test/tui/list.test.tsx`, `test/tui/references.test.tsx`), `test/fakes/index.ts` (fake
`OutputStore` keyed `${dir}/${path}`, exposed as `f.outputs`), `package.json`, the docs above.

Reused: `renderTemplate`, `slugify`, `matchesGlob`/`inclusionOf`, `applyEdits`/`replaceRange`,
`wrapFrontmatter`, `withScope`, `readNoteFile`, `index.outgoing`, `validateFields`,
`buildRegistry`'s clash-check pattern, `emit`/`reportError`/`table`, `note-store.ts`'s atomic write.

Implementation order: domain → config → ports + fakes + adapters → destination contract +
built-ins → registry → plan/execute/publish → doctor → CLI + capabilities → golden + integration →
docs + ADR 0006.

## Tests

- **domain**: `route` (vars, normalise/encode, `..` rejected, flat/directory/root paths, missing var
  names the note), `output-path` (`relativePath` matrix, `resolveOutputDir`, escaping), `select`
  (vault/visibility/include/exclude matrix with reasons; a glob never admits a private note),
  `classify` (policy × state), `collisions` (exact + case-insensitive), `plan`, `manifest`.
- **application** on `fixture()` (+ `addVault` for cross-vault references): plan does **no file
  reads** (wrap `deps.notes.read` to count); rewrite (title escaping, `\!` embed, keep-id verbatim,
  strip-to-label, drift → CONFLICT); markdown links `[Beta](./beta.md)` / `[Beta](../x/beta.md)`,
  frontmatter preserved; html `<a href="/beta/">Beta</a>` + manifest with `description`; astro
  (`modular`): file at `src/content/posts/<slug>.md`, frontmatter exactly `title/date/tags/id` +
  passed-through declared fields and nothing else, `date` is `YYYY-MM-DD` from `created`, links
  `[Beta](/posts/beta/)`, manifest at `.capture/manifest.json`, unknown theme → 6, a publication
  `route` that fights the theme → 6, doctor warns on a selected post lacking `description`; dry-run
  leaves `f.outputs` empty; `f.fs.writes` empty / `f.fs.files` unchanged; path collision → zero
  outputs; unknown name 3 / two vaults 4 / unknown kind or bad options 6 / output-inside-include 6;
  registry duplicate-kind and built-in shadowing rejected; doctor: fake destination with a
  required `date` field → warning on a selected note only, `undeclared` never reported.
- **infrastructure**: `html.test` (GFM table, task list, strikethrough, fenced code, raw HTML
  pass-through), `output-store.test` with `mkdtemp` (nested dirs, overwrite, `..` rejected, no temp
  files left), `vault-config.test` (parse, defaults, shorthand, bad policy, round-trip).
- **golden** (new pattern): `test/fixtures/publish/vault/` with three publications →
  `test/fixtures/publish/expected/{content,site,blog}/**` incl. each manifest; the test loads the
  vault into `fixture()` via the real `parseVaultConfig`, runs `publish`, compares both directions
  (stray files fail); `UPDATE_GOLDEN=1` rewrites. Fixed clock + no manifest timestamp.
- **integration** (`test/integration/publish.test.ts`, same tsx harness): init → append
  `publications:` → public + private notes, links public→private and public→missing → bare
  `publish` lists → `publish site --dry-run` exits 6 (violation under `fail`), lists the private
  note as `private`, no `dist/` → switch to `strip-to-label` → exit 0, `<a href="/…/">`, label text
  for the private target, `manifest.json` entries, sha256 of every source unchanged → `publish
  content` → `[Label](./…md)` + frontmatter kept → two notes with the same `slug` exit 6 with
  nothing written → unknown name exits 3.

## Verification

- `bun run check` (lint, format, typecheck, `vitest run`); locally the full suite needs
  `NODE_OPTIONS=--max-old-space-size=3072`.
- By hand in a scratch vault: add a `publications:` block → `notes publish` (lists) → `notes publish
  site --dry-run` → `notes publish site` → inspect `dist/` fragments + `manifest.json`; `notes publish
  content` into a folder outside the vault and open it in Obsidian to confirm relative links
  resolve; `notes doctor` shows `publication` findings when a selected note lacks a declared field.
