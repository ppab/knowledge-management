import { relative, resolve, sep } from 'node:path';
import { watch } from 'chokidar';
import type { FileChange, FileWatcher } from '../../application/ports.js';

/*
 * TUI-only (docs/architecture.md, ports table). Changes are batched per tick so a save that
 * writes a temp file and renames it is one change, and nothing under a dot directory is ever
 * reported: that is where the index (`.notes/cache/`) and Git write.
 */

export interface WatcherOptions {
  /** Quiet time after the last event before a batch is delivered. */
  readonly tickMs?: number;
}

const toPosix = (path: string): string => path.split(sep).join('/');

const isHidden = (relativePath: string): boolean =>
  relativePath.split('/').some((segment) => segment.startsWith('.'));

export const createFileWatcher = (options: WatcherOptions = {}): FileWatcher => ({
  watch(roots, onChange) {
    const tick = options.tickMs ?? 200;
    const absoluteRoots = roots.map((r) => resolve(r));
    const pending = new Map<string, FileChange>();
    let timer: NodeJS.Timeout | undefined;

    const flush = () => {
      timer = undefined;
      const changes = [...pending.values()];
      pending.clear();
      if (changes.length > 0) onChange(changes);
    };

    const classify = (file: string): FileChange | null => {
      for (const root of absoluteRoots) {
        const rel = relative(root, file);
        if (rel === '' || rel.startsWith('..')) continue;
        const path = toPosix(rel);
        if (isHidden(path) || !path.endsWith('.md')) return null;
        return { root, path };
      }
      return null;
    };

    const watcher = watch(absoluteRoots, {
      ignoreInitial: true,
      ignored: (file, stats) => {
        const rel = absoluteRoots
          .map((root) => relative(root, file))
          .find((r) => !r.startsWith('..'));
        if (rel === undefined || rel === '') return false;
        if (isHidden(toPosix(rel))) return true;
        return stats?.isFile() === true && !file.endsWith('.md');
      },
    });
    watcher.on('all', (_event, file) => {
      const change = classify(file);
      if (!change) return;
      pending.set(`${change.root}\0${change.path}`, change);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, tick);
    });

    return new Promise((resolveReady, reject) => {
      watcher.once('ready', () => {
        resolveReady(async () => {
          if (timer) clearTimeout(timer);
          await watcher.close();
        });
      });
      watcher.once('error', reject);
    });
  },
});
