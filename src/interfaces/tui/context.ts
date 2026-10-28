import { createContext, useContext, useEffect, useState } from 'react';
import type { PluginRegistry } from '../../application/plugin/plugin.js';
import type { AppDeps, ExternalEditor } from '../../application/ports.js';
import type { AppError } from '../../domain/errors.js';
import type { Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { Navigation } from './model.js';
import type { Theme } from './theme.js';

/** Everything the screens need, injected once by the runner (or a test). */
export interface TuiServices {
  readonly deps: AppDeps;
  readonly scope: Scope;
  readonly registry: PluginRegistry;
  readonly editor: ExternalEditor;
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
 */
export const useLoad = <T>(
  load: () => Promise<Result<T, AppError>>,
  keys: readonly unknown[],
): Loaded<T> => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  const key = JSON.stringify(keys);
  useEffect(() => {
    let live = true;
    setLoaded((previous) =>
      previous.value === undefined
        ? { state: 'loading' }
        : { state: 'loading', value: previous.value },
    );
    void load().then((result) => {
      if (!live) return;
      setLoaded((previous) =>
        result.ok
          ? { state: 'ready', value: result.value }
          : previous.value === undefined
            ? { state: 'error', error: result.error }
            : { state: 'error', error: result.error, value: previous.value },
      );
    });
    return () => {
      live = false;
    };
    // `key` stands for `keys`; `load` is a fresh closure on every render by design.
  }, [key]);
  return loaded;
};
