import type { AppError } from '../../domain/errors.js';
import type { NoteEntry } from '../../domain/note/note.js';
import { ok, type Result } from '../../domain/result.js';
import { loadNoteEntry } from '../notes/load-note.js';
import type { AppDeps, IndexedFile, NoteDocument, NoteFile, NoteIndex } from '../ports.js';
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

/** A file's physical identity for dedup: its real-path key, or its own path when unresolved. */
const keyOf = (file: NoteFile): string => file.physicalKey ?? file.path;

/** Appends `value` to the list at `key`, starting one if absent. */
const groupInto = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const group = map.get(key);
  if (group) group.push(value);
  else map.set(key, [value]);
};

/**
 * Collapses paths that resolve to the same physical note, keeping the lexicographically smallest
 * as canonical. Aliases of one note therefore index once; separate files sharing an id keep
 * distinct keys, stay distinct rows, and remain an `AMBIGUOUS` integrity error for the resolver.
 */
const canonicalFiles = (present: readonly NoteFile[]): NoteFile[] => {
  const groups = new Map<string, NoteFile[]>();
  for (const file of present) groupInto(groups, keyOf(file), file);
  return [...groups.values()].map((group) =>
    group.reduce((smallest, file) => (file.path < smallest.path ? file : smallest)),
  );
};

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

  const consider = async (
    file: NoteFile,
    row: IndexedFile | undefined,
  ): Promise<AppError | null> => {
    const doc = await deps.notes.read(vault.root, file.path);
    if (!doc.ok) {
      if (doc.error.code !== 'NOT_FOUND') return doc.error;
      if (row) removals.push(file.path);
      return null;
    }
    const next: NoteFile = {
      path: file.path,
      mtime: doc.value.mtime,
      size: doc.value.size,
      ...(doc.value.physicalKey !== undefined && { physicalKey: doc.value.physicalKey }),
    };
    if (row?.version === doc.value.version) {
      if (row.mtime !== next.mtime || row.size !== next.size) touches.push(next);
      else unchanged += 1;
      return null;
    }
    upserts.push({ entry: loadNoteEntry(deps, doc.value), file: next });
    return null;
  };

  if (options.paths) {
    // Read the targeted paths once, then decide whether any of them participates in a physical
    // alias group. If so, a targeted plan cannot keep "one row per key" on its own, so we fall
    // back to a full reconciliation of the whole vault (acceptable for this slice).
    const reads = new Map<string, NoteDocument | undefined>();
    for (const path of options.paths) {
      const doc = await deps.notes.read(vault.root, path);
      if (doc.ok) reads.set(path, doc.value);
      else if (doc.error.code === 'NOT_FOUND') reads.set(path, undefined);
      else return { ok: false, error: doc.error };
    }

    const pathsByKey = new Map<string, string[]>();
    for (const row of indexed.values()) groupInto(pathsByKey, keyOf(row), row.path);
    const sharedWithOther = (key: string, self: string): boolean =>
      (pathsByKey.get(key) ?? []).some((p) => p !== self);
    const involvesAlias = [...reads].some(([path, doc]) => {
      if (doc && keyOf(doc) !== path) return true; // the target is itself an alias
      if (doc && sharedWithOther(keyOf(doc), path)) return true; // another path maps here
      const row = indexed.get(path);
      return row !== undefined && sharedWithOther(keyOf(row), path); // altering a shared note
    });
    if (involvesAlias) return planRefresh(deps, vault, index, {});

    for (const [path, doc] of reads) {
      const row = indexed.get(path);
      if (!doc) {
        if (row) removals.push(path);
        continue;
      }
      const next: NoteFile = {
        path,
        mtime: doc.mtime,
        size: doc.size,
        ...(doc.physicalKey !== undefined && { physicalKey: doc.physicalKey }),
      };
      if (row?.version === doc.version) {
        if (row.mtime !== next.mtime || row.size !== next.size) touches.push(next);
        else unchanged += 1;
      } else {
        upserts.push({ entry: loadNoteEntry(deps, doc), file: next });
      }
    }
    return ok({ upserts, touches, removals, unchanged });
  }

  const present = await deps.notes.list(vault.root, vault.config.include, vault.config.exclude);
  const canonical = canonicalFiles(present);
  const seen = new Set(canonical.map((f) => f.path));
  for (const file of canonical) {
    const row = indexed.get(file.path);
    if (row?.mtime === file.mtime && row.size === file.size && keyOf(row) === keyOf(file)) {
      unchanged += 1;
      continue;
    }
    const failure = await consider(file, row);
    if (failure) return { ok: false, error: failure };
  }
  // Drop any indexed path that is gone or now shadowed by a lexically smaller alias.
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
