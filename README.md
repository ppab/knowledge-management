# OpenFormLink (`ofl`)

Local-first, Git-native knowledge management for the terminal: a CLI for scripts and agents, and
a TUI for reading, linking and editing notes. Notes are Markdown files with YAML frontmatter in
a directory you own; a SQLite index is derived from them and can be rebuilt at any time; history
is your Git repository.

## Install

`ofl` ships as a single executable that needs no Node or Bun installed. Only `git` must be on
your `PATH` for history and `save`, and an editor (`$VISUAL`/`$EDITOR`) for `edit`.

Pick the file for your machine from `release/` (after `bun run compile:all`, see below):

| Machine             | File                       |
| ------------------- | -------------------------- |
| Linux x64           | `release/ofl-linux-x64`    |
| Linux arm64         | `release/ofl-linux-arm64`  |
| macOS Apple Silicon | `release/ofl-darwin-arm64` |
| macOS Intel         | `release/ofl-darwin-x64`   |

Run it in place, or put it on your `PATH` as `ofl`:

```bash
./release/ofl-linux-x64 --version
install -m 755 release/ofl-linux-x64 ~/.local/bin/ofl
ofl --help
```

On macOS the binaries are not signed. After copying one over, mark it executable and clear the
quarantine flag if Gatekeeper refuses it:

```bash
chmod +x ofl
xattr -d com.apple.quarantine ofl
```

## Quick start

```bash
mkdir ~/wiki && cd ~/wiki
git init                      # optional: enables history, diff and save
ofl init --name wiki          # writes .ofl/config.yaml
ofl create --title "First note"
ofl                           # opens the TUI in the current vault
```

Inside the TUI: `j`/`k` move, `Enter` opens a note, `/` searches, `c` creates, `Space` opens the
command menu, `Esc` goes back and `q` quits. In a note: vim motions (`hjkl`, `w`/`b`/`e`),
`i`/`a` insert a reference, `v` selects text to turn into a reference, `x` removes the
reference under the cursor, `o` opens the file in your editor, `s` saves a revision to git and
`H` shows the history.

From a script or an agent, every command takes `--json` and reports failures with a stable exit
code (`ofl capabilities --json` lists the commands, flags and codes):

```bash
ofl list --json
ofl search kumquat --json
ofl show "first note" --json
ofl save "first note" -m "first words"
```

Several vaults can be read together: pass `--vault <path>` more than once, or define named scopes
in `$XDG_CONFIG_HOME/ofl/config.yaml` and select one with `--scope <name>`.

## Publishing

Only notes marked `visibility: public` are ever eligible to publish (the default is `private`).
Declare named **publications** in `.ofl/config.yaml`, each pointing at a **destination**:

```yaml
publications:
  site:
    destination: { kind: html, layout: directory } # or: destination: markdown
    output: ./dist
    include: ['docs/**']
    references: fail # fail | strip-to-label | keep-id
  blog:
    destination: { kind: astro, theme: modular } # Markdown into an Astro content collection
    output: ../my-site
    include: ['posts/**']
    references: strip-to-label
```

```bash
ofl publish                 # list the configured publications
ofl publish site --dry-run  # print the plan (routes, exclusions, reference violations); write nothing
ofl publish site            # write it; source notes are never modified
```

References between published notes become real links; a reference to an excluded or missing note is
handled by the publication's `references` policy. Every publication also emits a `manifest.json`.

## Build from source

Requirements: Node ≥ 24 and Bun ≥ 1.4 (both pinned in `mise.toml`; `mise install` provides them).

```bash
bun install                   # dependencies, from bun.lock
bun run check                 # lint, format, typecheck, tests
bun run build && node bin/ofl --version   # the Node build in dist/
bun run compile               # executable for this machine → release/
bun run compile:all           # Linux and macOS, x64 and arm64
```

`bun run test` includes a smoke test of the compiled binary for the current machine; it is
skipped until `bun run compile` has run.

## Continuous integration

`.github/workflows/ci.yml` validates every pull request and every push to `main`. It installs the
Node and Bun versions pinned in `mise.toml`, installs dependencies from the frozen `bun.lock`, and
then runs the same commands you run locally:

```bash
bun install --frozen-lockfile   # dependencies, without touching bun.lock
bun run compile                 # host binary first, so the smoke tests below run
bun run check                   # lint, format check, typecheck, tests (incl. the binary smoke test)
bun run build                   # the Node build in dist/
```

The host executable is compiled before `bun run check` so the compiled-binary smoke test is
exercised rather than skipped, and the suite still runs only once. The workflow has read-only
repository permissions and performs no publishing, deployment, or writes back to the repository; a
failing step fails the run.

## Documentation

- `docs/architecture.md`: layers, domain model, ports, TUI and CLI contracts.
- `docs/plugins.md`: writing a plugin (panels, commands, fields, chords).
- `docs/decisions/`: architecture decision records.
- `docs/plan.md`: milestones and their status.
