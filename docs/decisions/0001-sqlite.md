# 0001 — Use `node:sqlite` for the derived index

Date: 2026-10-27 · Status: accepted

## Context

The index needs full-text search (FTS5 with `bm25()`), and the project must not require a
native build step to install. Candidates: `node:sqlite` (bundled with Node ≥ 22.5, stable in
24), `better-sqlite3` (native addon, prebuilt binaries for common platforms).

## Check

On the target platform (Node 26.12.0, Linux) `node:sqlite` loads without a flag and ships
SQLite 3.54.0 with FTS5 compiled in:

```
CREATE VIRTUAL TABLE t USING fts5(title, body)   -- ok
SELECT title, bm25(t) FROM t WHERE t MATCH 'pipeline' ORDER BY bm25(t)   -- ok
```

## Decision

Use `node:sqlite` (`DatabaseSync`). `engines.node >= 24`. No fallback adapter until a platform
without FTS5 in its bundled SQLite is actually encountered; the `NoteIndex` port keeps that
swap local to `src/infrastructure/sqlite/`.

## Consequences

- Zero native dependencies; `npm install` never compiles anything.
- The synchronous API fits a CLI; the TUI watcher keeps writes small (one note per refresh).
- Node 22 users must pass `--experimental-sqlite`; not supported in v0.1.
