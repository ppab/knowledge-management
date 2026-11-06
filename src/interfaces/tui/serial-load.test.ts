import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../../domain/result.js';
import { unavailable } from '../../domain/errors.js';
import { createSerialLoader } from './serial-load.js';

/** A load whose resolution the test controls, tracking whether it was ever started. */
const deferred = <T>(value: Result<T, never> | Result<never, ReturnType<typeof unavailable>>) => {
  let resolve!: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });
  let started = false;
  return {
    get started() {
      return started;
    },
    release: resolve,
    load: async (): Promise<typeof value> => {
      started = true;
      await gate;
      return value;
    },
  };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('serial loader', () => {
  it('runs a single load and delivers its result', async () => {
    const loader = createSerialLoader<number>();
    const delivered: number[] = [];
    loader.submit(
      () => Promise.resolve(ok(1)),
      (r) => r.ok && delivered.push(r.value),
    );
    await flush();
    expect(delivered).toEqual([1]);
  });

  it('never runs two loads at once; a waiting submission starts only after the first settles', async () => {
    const loader = createSerialLoader<number>();
    const first = deferred(ok(1));
    const second = deferred(ok(2));
    const delivered: number[] = [];

    loader.submit(first.load, (r) => r.ok && delivered.push(r.value));
    loader.submit(second.load, (r) => r.ok && delivered.push(r.value));
    await flush();

    // The second has not started while the first is still in flight.
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);

    first.release();
    await flush();
    expect(second.started).toBe(true);
    second.release();
    await flush();
    expect(delivered).toEqual([2]);
  });

  it('collapses a burst to the newest survivor and drops superseded results', async () => {
    const loader = createSerialLoader<number>();
    const first = deferred(ok(1));
    const delivered: number[] = [];

    loader.submit(first.load, (r) => r.ok && delivered.push(r.value));
    // Three more arrive while the first runs; only the last should run next.
    loader.submit(
      () => Promise.resolve(ok(2)),
      (r) => r.ok && delivered.push(r.value),
    );
    loader.submit(
      () => Promise.resolve(ok(3)),
      (r) => r.ok && delivered.push(r.value),
    );
    loader.submit(
      () => Promise.resolve(ok(4)),
      (r) => r.ok && delivered.push(r.value),
    );

    first.release();
    await flush();

    // The first's result is superseded (never delivered); the newest survivor wins.
    expect(delivered).toEqual([4]);
  });

  it('delivers errors like any other result', async () => {
    const loader = createSerialLoader<number>();
    const results: Result<number, ReturnType<typeof unavailable>>[] = [];
    loader.submit(
      () => Promise.resolve(err(unavailable('nope'))),
      (r) => results.push(r),
    );
    await flush();
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
  });

  it('abandons delivery once no longer live', async () => {
    let live = true;
    const loader = createSerialLoader<number>(() => live);
    const only = deferred(ok(1));
    const delivered: number[] = [];

    loader.submit(only.load, (r) => r.ok && delivered.push(r.value));
    await flush();
    live = false;
    only.release();
    await flush();
    expect(delivered).toEqual([]);
  });

  it('runs again after the queue drains', async () => {
    const loader = createSerialLoader<number>();
    const delivered: number[] = [];
    loader.submit(
      () => Promise.resolve(ok(1)),
      (r) => r.ok && delivered.push(r.value),
    );
    await flush();
    loader.submit(
      () => Promise.resolve(ok(2)),
      (r) => r.ok && delivered.push(r.value),
    );
    await flush();
    expect(delivered).toEqual([1, 2]);
  });
});
