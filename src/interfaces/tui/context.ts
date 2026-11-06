import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { PluginRegistry } from '../../application/plugin/plugin.js';
import type { AppDeps } from '../../application/ports.js';
import type { AppError } from '../../domain/errors.js';
import type { Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { Navigation } from './model.js';
import { createSerialLoader, type SerialLoader } from './serial-load.js';
import type { Theme } from './theme.js';

/** Everything the screens need, injected once by the runner (or a test). */
export interface TuiServices {
  readonly deps: AppDeps;
  readonly scope: Scope;
  readonly registry: PluginRegistry;
  /**
   * Hands a file to the external editor. The runner tears the TUI down around the handoff (see
   * `runTui`), so this returns nothing: the caller's screen is gone by the time the editor runs,
   * and the fresh render on return reloads from disk.
   */
  readonly requestEdit: (file: string, command?: string) => void;
  readonly cwd: string;
  readonly theme: Theme;
}

/** Fires whenever note files changed on disk; the runner adapts the `FileWatcher` port. */
export interface ChangeFeed {
  subscribe(listener: () => void): () => void;
}

export interface StatusMessage {
  readonly text: string;
  readonly level: 'info' | 'error';
}

export interface TuiState extends TuiServices {
  /** Bumped on every watcher tick; loaders depend on it. */
  readonly revision: number;
  readonly rows: number;
  readonly columns: number;
  readonly status: StatusMessage | null;
  readonly notify: (text: string, level?: 'info' | 'error') => void;
  readonly report: (error: AppError) => void;
  readonly navigate: (action: Navigation) => void;
  readonly quit: () => void;
}

export const TuiContext = createContext<TuiState | null>(null);

export const useTui = (): TuiState => {
  const state = useContext(TuiContext);
  if (!state) throw new Error('useTui outside of <App>');
  return state;
};

export type Loaded<T> =
  | { readonly state: 'loading'; readonly value?: T }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'error'; readonly error: AppError; readonly value?: T };

/**
 * Runs a use case whenever `keys` change, keeping the previous value on screen meanwhile so a
 * watcher tick never blanks the view. The last result wins; stale ones are dropped.
 *
 * Loads are serialized: at most one runs at a time, and when several key changes arrive while
 * one is in flight only the newest survivor runs next. A use case here means a full index
 * refresh and, for history, spawning Git, so letting a burst of watcher ticks stack overlapping
 * loads would thrash CPU and I/O for results that are thrown away anyway.
 */
export const useLoad = <T>(
  load: () => Promise<Result<T, AppError>>,
  keys: readonly unknown[],
): Loaded<T> => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  const key = JSON.stringify(keys);
  const mounted = useRef(true);
  const loader = useRef<SerialLoader<T> | null>(null);
  loader.current ??= createSerialLoader<T>(() => mounted.current);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    setLoaded((previous) =>
      previous.value === undefined
        ? { state: 'loading' }
        : { state: 'loading', value: previous.value },
    );
    loader.current?.submit(load, (result) => {
      setLoaded((previous) =>
        result.ok
          ? { state: 'ready', value: result.value }
          : previous.value === undefined
            ? { state: 'error', error: result.error }
            : { state: 'error', error: result.error, value: previous.value },
      );
    });
    // `key` stands for `keys`; `load` is a fresh closure on every render by design.
  }, [key]);
  return loaded;
};
