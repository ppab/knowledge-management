# 0009 — Astro themes declared in the vault

Date: 2026-11-20 · Status: accepted (implemented) · follows [0007](./0007-destination-options.md)

## Context

[0007](./0007-destination-options.md) made an Astro theme a pluggable profile: the built-in
`modular`, plus themes a first-party plugin contributes through `astroThemes`. Either way a theme
is code compiled into the binary. Publishing to a site of one's own — a personal site with its own
collections, frontmatter schema and one content folder per locale — therefore meant writing a
plugin for that one site and rebuilding `ofl` whenever the site's rules changed. Plugins are not
loaded dynamically (`plugins.md` rule 5), and loading code from a vault would need a security
story we do not have.

Looking at what such a theme actually says, none of it needs code. It is a mapping: where a
collection's files go, its URL shape, which fields a note must carry, and which frontmatter keys
the site reads. [0006](./0006-publishing-destinations.md) already listed "declarative custom
themes" as deferred.

The first real target also showed two things the theme contract could not express: a collection
whose files are not at `<collection>/<slug>.md`, and requirements strong enough to stop a publish —
the site's build fails on a note without its required key, and `doctor` only warns.

## Decision

### A theme is a data file in the vault

A vault declares a theme as `.ofl/astro-themes/<name>/theme.yaml`. The directory name is the theme
name; the directory leaves room for files that belong to a theme later. Themes are read with the
vault's configuration (`VaultRepository.load`) and travel on `VaultConfig.astroThemes`, so the
registry — which sees only the scope's configs — needs no new port. The file is validated strictly
when read (unknown keys, an unknown placeholder, a path that escapes the content directory, a bad
pattern); a broken theme blocks the vault from opening and names its file, exactly like a broken
`publications:` block.

The registry compiles each declared theme into the same `AstroTheme` contract `modular` implements
and offers it to that vault's `astro` kind. A declared theme belongs to its vault alone: two vaults
may each declare `site`. Within a vault the single-owner rule holds — a declared theme may not take
the name of the built-in or of a theme a plugin gives that vault.

```yaml
# .ofl/astro-themes/site/theme.yaml
version: 0.1.0 # the ofl version this file was written for
contentDir: src/content # default
collections:
  notebook:
    route: /notebook/{{slug}}/
    path: notebook/en/{{slug}}.md # default: <collection>/{{slug}}.md
    images: forbid # default: allow
    fields:
      - { name: slug, required: true }
      - { name: kind, required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*' }
      - { name: hideFromIndex, type: boolean }
    frontmatter:
      title: title
      kind: kind
      summary: [summary, description]
      date: { from: created, as: date }
```

### A file states the ofl version it was written for

`version:` is required in a theme file, and it is the ofl version, not a separate format number:
one number to know, and it says exactly which build's documentation the file follows. A later ofl
can change what a key means and still read an older file correctly, because it knows which rules
the file was written under. A file written for a newer ofl than the one running is refused with
"update ofl" — and that check comes before the rest of the schema, so the report is the version
rather than a list of keys this build does not recognize. The check lives in `domain/version.ts`,
which now holds the ofl version the CLI reports.

The `template:` block of a note template takes the same `version:`. It is optional there:
templates predate it, and one without a version is read as it always was.

### The mapping is explicit

`frontmatter` lists every key the published file gets and where it comes from: a source name, a
list of fallbacks, or `{ from, as: date }` to trim an instant to `YYYY-MM-DD`. `title`, `id`,
`slug`, `type` and `tags` are the entry's resolved core values; any other name is read from the
note's frontmatter. A key with no value is left out. Nothing is copied implicitly — a note's
bookkeeping (`id`, `visibility`, undeclared keys) reaches the site only if the theme maps it.

### A collection may place its own files

`AstroCollection.path` is a template under `contentDir` using `{{slug}}`, `{{id}}` or `{{stem}}`
(the placeholders every entry defines). Absent, the path is `<collection>/{{slug}}.md` as before,
so `modular` is unchanged. One folder per locale is then two collections with two paths and two
routes; `ofl` still has no notion of language.

### A theme's requirements refuse the publication

`Destination.entryProblems(entry, options)` returns what stops an entry from being published. A
declared collection reports: a `required` field that is missing, a value of the wrong type, and a
`string` that does not match its `pattern`. `publish` refuses the whole publication on any
problem and writes nothing; `--dry-run` lists them and exits 6; `doctor` reports them as warnings.

A field may name one of the core keys `slug`, `type` or `tags`, and then says only that the note
must set it itself. A required `slug` is the point: the published URL and file name stop following
the title.

`images: forbid` refuses a note whose body shows an image (Markdown syntax or a raw `<img>`, not
one inside code). Publishing does not copy assets, so an image would arrive broken; a collection
that cannot take that says so. This is checked at render time, before the first write.

`modular` keeps its old behaviour — its required `description` is still a `doctor` warning. Making
a compiled-in theme strict is a separate decision.

## Consequences

- New `domain/version.ts` (the ofl version and the check of a file's stated version),
  `domain/publishing/astro-theme.ts` (the declaration as pure data),
  `infrastructure/config/astro-theme-file.ts` (its schema), and
  `application/publishing/destinations/astro-themes/declared.ts` (the compiler). `VaultConfig`
  gains `astroThemes`; it is read from the theme files and never written back into `config.yaml`.
- `PublishOutcome` of a dry run carries `problems`; the CLI prints them and its JSON gains
  `problems`, with `publishable` false when there are any.
- No site-specific code enters the binary: a new site, or a change to a site's rules, is an edit to
  a YAML file in the vault.
- **Deliberately deferred:** listing a vault's declared themes in `capabilities` (it describes the
  binary, not a vault); copying images (which would lift `images: forbid`); constant values and
  further transforms in `frontmatter`; a `--clean` for outputs a theme no longer produces.
