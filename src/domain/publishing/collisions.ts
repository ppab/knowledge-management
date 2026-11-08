/*
 * Two emitted entries must never share a route or an output path. Both checks fold case — routes
 * are compared case-insensitively because URLs are, and output paths because a case-insensitive
 * filesystem would otherwise silently overwrite one file with another.
 */

export interface Collision {
  readonly key: string;
  readonly ids: readonly string[];
}

const groupByFoldedKey = (
  entries: readonly { readonly id: string; readonly key: string }[],
): Collision[] => {
  const groups = new Map<string, { key: string; ids: string[] }>();
  for (const entry of entries) {
    const folded = entry.key.toLowerCase();
    const group = groups.get(folded);
    if (group) group.ids.push(entry.id);
    else groups.set(folded, { key: entry.key, ids: [entry.id] });
  }
  return [...groups.values()].filter((group) => group.ids.length > 1);
};

/** Entries whose routes collide, exactly or by case. */
export const findRouteCollisions = (
  entries: readonly { readonly id: string; readonly route: string }[],
): Collision[] => groupByFoldedKey(entries.map((entry) => ({ id: entry.id, key: entry.route })));

/** Entries whose output paths collide, exactly or by case. */
export const findPathCollisions = (
  entries: readonly { readonly id: string; readonly path: string }[],
): Collision[] => groupByFoldedKey(entries.map((entry) => ({ id: entry.id, key: entry.path })));
