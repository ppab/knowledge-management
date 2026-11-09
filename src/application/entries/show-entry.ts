import { conflict, type AppError } from '../../domain/errors.js';
import type { Entry } from '../../domain/entry/entry.js';
import type { EntrySummary } from '../../domain/entry/summary.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { readEntryInScope, withScope, type IndexedEntry } from '../scope/session.js';
import type { AppDeps, EntryIndex } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadEntry } from './load-entry.js';
import { resolveEntry } from './resolve-entry.js';

/**
 * Reads the file behind an index summary: the index never serves content, and the returned
 * `version` is what a later write must present.
 */
export const readEntryFile = async (
  deps: AppDeps,
  vault: VaultHandle,
  summary: EntrySummary,
): Promise<Result<Entry, AppError>> => {
  const doc = await deps.entries.read(vault.root, summary.path);
  if (!doc.ok) return doc;
  const entry = loadEntry(deps, doc.value);
  if (entry.kind !== 'entry' || entry.id !== summary.id) {
    return err(
      conflict(`${summary.path} changed while it was being read; retry`, { path: summary.path }),
    );
  }
  return ok(entry);
};

/** Single-vault resolution and read, for callers that already hold the vault's index. */
export const readEntry = async (
  deps: AppDeps,
  vault: VaultHandle,
  index: EntryIndex,
  query: string,
): Promise<Result<Entry, AppError>> => {
  const summary = resolveEntry(index, query);
  if (!summary.ok) return summary;
  return readEntryFile(deps, vault, summary.value);
};

export const showEntry = (
  deps: AppDeps,
  scope: Scope,
  query: string,
): Promise<Result<IndexedEntry, AppError>> =>
  withScope(deps, scope, (session) => readEntryInScope(deps, session, query));
