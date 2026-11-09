import type { AppError } from '../../domain/errors.js';
import { ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { AppDeps } from '../ports.js';
import { listNotes } from './list-notes.js';

/** Every distinct tag used across the scope, sorted, so the tag picker can offer them for reuse. */
export const listTags = async (
  deps: AppDeps,
  scope: Scope,
): Promise<Result<string[], AppError>> => {
  const entries = await listNotes(deps, scope);
  if (!entries.ok) return entries;
  const seen = new Set<string>();
  for (const entry of entries.value) for (const tag of entry.tags) seen.add(tag);
  return ok([...seen].sort((a, b) => a.localeCompare(b)));
};
