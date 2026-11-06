import type { ChangeFeed } from './context.js';

/*
 * Adapts the watcher to the feed the <App> subscribes to. The editor handoff does not pause this:
 * it stops the watcher outright (see `runTui`), so no ticks arrive while an editor owns the
 * terminal and the parent process stays dormant.
 */

export interface ChangeDispatcher {
  /** Handed to the <App>; screens subscribe for reloads. */
  readonly feed: ChangeFeed;
  /** Called by the watcher on every batch of file changes. */
  notify(): void;
}

export const createChangeDispatcher = (): ChangeDispatcher => {
  const listeners = new Set<() => void>();
  return {
    feed: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
};
