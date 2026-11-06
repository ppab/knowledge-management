import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    // The integration tests spawn `tsx` subprocesses (each paying TS start-up) and run in
    // parallel on CI, where a single heavy test (e.g. the todos plugin end-to-end) can brush
    // 20s under load. A roomier cap only ever gives a slow-but-correct test time to finish; a
    // genuine hang still fails, just later.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
