/*
 * A unified diff for `--dry-run` previews. Lines keep their line terminator so a missing
 * final newline is a real difference, reported the way `diff` does.
 */

interface Op {
  readonly kind: ' ' | '-' | '+';
  readonly line: string;
}

const splitLines = (text: string): string[] => (text === '' ? [] : text.split(/(?<=\n)/));

/** Classic LCS table over the differing middle; `n * m` cells, so it is bounded by the caller. */
const lcsOps = (a: readonly string[], b: readonly string[]): Op[] => {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  const at = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const lineA = a[i] ?? '';
    const lineB = b[j] ?? '';
    if (lineA === lineB) {
      ops.push({ kind: ' ', line: lineA });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      ops.push({ kind: '-', line: lineA });
      i += 1;
    } else {
      ops.push({ kind: '+', line: lineB });
      j += 1;
    }
  }
  for (; i < n; i++) ops.push({ kind: '-', line: a[i] ?? '' });
  for (; j < m; j++) ops.push({ kind: '+', line: b[j] ?? '' });
  return ops;
};

/** Alignment of `a` to `b`; the common prefix and suffix are stripped before the LCS. */
const align = (a: readonly string[], b: readonly string[]): Op[] => {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const middle: Op[] =
    midA.length > 0 && midB.length > 0 && midA.length * midB.length <= 4_000_000
      ? lcsOps(midA, midB)
      : [
          ...midA.map((line): Op => ({ kind: '-', line })),
          ...midB.map((line): Op => ({ kind: '+', line })),
        ];
  return [
    ...a.slice(0, prefix).map((line): Op => ({ kind: ' ', line })),
    ...middle,
    ...a.slice(a.length - suffix).map((line): Op => ({ kind: ' ', line })),
  ];
};

const render = (op: Op): string =>
  op.line.endsWith('\n')
    ? `${op.kind}${op.line}`
    : `${op.kind}${op.line}\n\\ No newline at end of file\n`;

const CONTEXT = 3;

export const unifiedDiff = (before: string, after: string, path: string): string => {
  if (before === after) return '';
  const ops = align(splitLines(before), splitLines(after));
  const changed = ops.map((op, i) => (op.kind === ' ' ? -1 : i)).filter((i) => i >= 0);

  // Group changes whose context windows touch into one hunk.
  const hunks: { from: number; to: number }[] = [];
  for (const i of changed) {
    const last = hunks[hunks.length - 1];
    if (last && i - last.to <= CONTEXT * 2 + 1) last.to = i;
    else hunks.push({ from: i, to: i });
  }

  let out = `--- a/${path}\n+++ b/${path}\n`;
  let oldLine = 1;
  let newLine = 1;
  let cursor = 0;
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.from - CONTEXT);
    const end = Math.min(ops.length, hunk.to + CONTEXT + 1);
    for (const op of ops.slice(cursor, start)) {
      if (op.kind !== '+') oldLine += 1;
      if (op.kind !== '-') newLine += 1;
    }
    const slice = ops.slice(start, end);
    const oldCount = slice.filter((op) => op.kind !== '+').length;
    const newCount = slice.filter((op) => op.kind !== '-').length;
    out += `@@ -${String(oldLine)},${String(oldCount)} +${String(newLine)},${String(newCount)} @@\n`;
    out += slice.map(render).join('');
    oldLine += oldCount;
    newLine += newCount;
    cursor = end;
  }
  return out;
};
