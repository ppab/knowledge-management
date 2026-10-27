import type { AppError } from '../../domain/errors.js';
import type { NoteEntry } from '../../domain/note/note.js';
import { ok, type Result } from '../../domain/result.js';
import { loadNoteEntry } from '../notes/load-note.js';
import type { AppDeps, IndexedFile, NoteFile, NoteIndex } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';

/*
 * Incremental refresh. A file whose mtime and size match the index is assumed unchanged; any
 * other file is read and compared by content hash, so a `touch` never re-indexes and an edit
 * that keeps the size is still caught. Files no longer matched by the vault's globs are dropped.
 */

export interface RefreshPlan {
  readonly upserts: readonly { readonly entry: NoteEntry; readonly file: NoteFile }[];
  readonly touches: readonly NoteFile[];
  readonly removals: readonly string[];
  readonly unchanged: number;
}

export interface StaleReport {
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly removed: readonly string[];
}

export const staleOf = (plan: RefreshPlan, indexed: ReadonlySet<string>): StaleReport => ({
  added: plan.upserts.filter((u) => !indexed.has(u.file.path)).map((u) => u.file.path),
  modified: plan.upserts.filter((u) => indexed.has(u.file.path)).map((u) => u.file.path),
  removed: [...plan.removals],
});

export const isStale = (stale: StaleReport): boolean =>
  stale.added.length + stale.modified.length + stale.removed.length > 0;

export interface PlanOptions {
  /** Only consider these paths; everything else in the index is left as is. */
  readonly paths?: readonly string[];
}

export const planRefresh = async (
  deps: AppDeps,
  vault: VaultHandle,
  index: NoteIndex,
  options: PlanOptions = {},
): Promise<Result<RefreshPlan, AppError>> => {
  const indexed = new Map<string, IndexedFile>(index.files().map((f) => [f.path, f]));
  const upserts: { entry: NoteEntry; file: NoteFile }[] = [];
  const touches: NoteFile[] = [];
  const removals: string[] = [];
  let unchanged = 0;

  const consider = async (path: string, row: IndexedFile | undefined): Promise<AppError | null> => {
    const doc = await deps.notes.read(vault.root, path);
    if (!doc.ok) {
      if (doc.error.code !== 'NOT_FOUND') return doc.error;
      if (row) removals.push(path);
      return null;
    }
    const file = { path, mtime: doc.value.mtime, size: doc.value.size };
    if (row?.version === doc.value.version) {
      if (row.mtime !== file.mtime || row.size !== file.size) touches.push(file);
      else unchanged += 1;
      return null;
    }
    upserts.push({ entry: loadNoteEntry(deps, doc.value), file });
    return null;
  };

  if (options.paths) {
    for (const path of options.paths) {
      const failure = await consider(path, indexed.get(path));
      if (failure) return { ok: false, error: failure };
    }
    return ok({ upserts, touches, removals, unchanged });
  }

  const present = await deps.notes.list(vault.root, vault.config.include, vault.config.exclude);
  const seen = new Set<string>();
  for (const file of present) {
    seen.add(file.path);
    const row = indexed.get(file.path);
    if (row?.mtime === file.mtime && row.size === file.size) {
      unchanged += 1;
      continue;
    }
    const failure = await consider(file.path, row);
    if (failure) return { ok: false, error: failure };
  }
  for (const path of indexed.keys()) if (!seen.has(path)) removals.push(path);
  return ok({ upserts, touches, removals: removals.sort(), unchanged });
};

export interface RefreshReport extends StaleReport {
  readonly unchanged: number;
}

export const applyPlan = (index: NoteIndex, plan: RefreshPlan): RefreshReport => {
  const indexed = new Set(index.files().map((f) => f.path));
  index.batch(() => {
    for (const path of plan.removals) index.remove(path);
    for (const file of plan.touches) index.touch(file);
    for (const { entry, file } of plan.upserts) index.upsert(entry, file);
  });
  return { ...staleOf(plan, indexed), unchanged: plan.unchanged };
};

export const refreshIndex = async (
  deps: AppDeps,
  vault: VaultHandle,
  index: NoteIndex,
  options: PlanOptions = {},
): Promise<Result<RefreshReport, AppError>> => {
  const plan = await planRefresh(deps, vault, index, options);
  if (!plan.ok) return plan;
  return ok(applyPlan(index, plan.value));
};

export const rebuildIndex = async (
  deps: AppDeps,
  vault: VaultHandle,
  index: NoteIndex,
): Promise<Result<RefreshReport, AppError>> => {
  index.clear();
  return refreshIndex(deps, vault, index);
};

export interface IndexStatus {
  readonly stats: ReturnType<NoteIndex['stats']>;
  readonly stale: StaleReport;
}

/** Reports what a refresh would change without changing anything. */
export const indexStatus = async (
  deps: AppDeps,
  vault: VaultHandle,
  index: NoteIndex,
): Promise<Result<IndexStatus, AppError>> => {
  const plan = await planRefresh(deps, vault, index);
  if (!plan.ok) return plan;
  const indexed = new Set(index.files().map((f) => f.path));
  return ok({ stats: index.stats(), stale: staleOf(plan.value, indexed) });
};

/**
 * Opens the vault's index, brings it up to date and runs `work` against it. Every read use
 * case goes through here, which is what makes `.notes/cache/` safe to delete at any time.
 */
export const withFreshIndex = async <T>(
  deps: AppDeps,
  vault: VaultHandle,
  work: (index: NoteIndex) => Promise<Result<T, AppError>> | Result<T, AppError>,
): Promise<Result<T, AppError>> => {
  const opened = await deps.indexes.open(vault.root);
  if (!opened.ok) return opened;
  const index = opened.value;
  try {
    const refreshed = await refreshIndex(deps, vault, index);
    if (!refreshed.ok) return refreshed;
    return await work(index);
  } finally {
    index.close();
  }
};
