/**
 * Merges per-vault rankings by rank position (decision A10): the first result of every vault,
 * then the second of every vault, and so on, vaults in scope order. Scores from different
 * indexes are never compared.
 */
export const interleaveByRank = <T>(rankings: readonly (readonly T[])[]): T[] => {
  const merged: T[] = [];
  const longest = Math.max(0, ...rankings.map((r) => r.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const ranking of rankings) {
      const item = ranking[rank];
      if (item !== undefined) merged.push(item);
    }
  }
  return merged;
};
