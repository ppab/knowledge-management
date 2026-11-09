export interface DuplicateId {
  readonly id: string;
  /** Sorted, so reports are stable. */
  readonly paths: readonly string[];
}

/**
 * Identity must be unique within a vault. Two files sharing an `id` is a data error that no
 * command may silently resolve by picking one; this rule names every offender.
 */
export const findDuplicateIds = (
  entries: readonly { readonly id?: string; readonly path: string }[],
): DuplicateId[] => {
  const byId = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.id === undefined) continue;
    const paths = byId.get(entry.id);
    if (paths) paths.push(entry.path);
    else byId.set(entry.id, [entry.path]);
  }
  return [...byId]
    .filter(([, paths]) => paths.length > 1)
    .map(([id, paths]) => ({ id, paths: [...paths].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
};
