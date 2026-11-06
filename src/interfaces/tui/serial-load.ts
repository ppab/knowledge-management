import type { AppError } from '../../domain/errors.js';
import type { Result } from '../../domain/result.js';

/*
 * Serializes async loads so a burst of requests never stacks overlapping work. At most one load
 * runs at a time; while it runs, a newer submission replaces any waiting one, so only the latest
 * survivor runs next and the results of superseded loads are dropped. A use case behind these
 * loads means a full index refresh and, for history, spawning Git, so letting watcher ticks pile
 * up overlapping loads would thrash CPU and I/O for results that are thrown away anyway.
 *
 * `isLive` lets the caller abandon delivery after teardown (an unmounted screen).
 */
export interface SerialLoader<T> {
  submit(
    load: () => Promise<Result<T, AppError>>,
    deliver: (result: Result<T, AppError>) => void,
  ): void;
}

interface Request<T> {
  readonly load: () => Promise<Result<T, AppError>>;
  readonly deliver: (result: Result<T, AppError>) => void;
}

export const createSerialLoader = <T>(isLive: () => boolean = () => true): SerialLoader<T> => {
  let pending: Request<T> | null = null;
  let running = false;
  // A submission counter, bumped on every `submit`. A load delivers only if no newer submission
  // arrived while it ran, so a burst collapses to its latest survivor. Reading `pending` through
  // a helper keeps its type the full union rather than narrowing to the last clear.
  let latest = 0;
  const take = (): Request<T> | null => {
    const next = pending;
    pending = null;
    return next;
  };
  return {
    submit(load, deliver) {
      latest += 1;
      pending = { load, deliver };
      if (running) return;
      running = true;
      void (async () => {
        for (let next = take(); next !== null; next = take()) {
          const mine = latest;
          const result = await next.load();
          if (!isLive()) return;
          // A newer submission arrived while this ran; run it instead of delivering a stale one.
          if (latest !== mine) continue;
          next.deliver(result);
        }
        running = false;
      })();
    },
  };
};
