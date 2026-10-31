import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    restoreMocks: true,
    // Mandatory, shared by every package (see test-support/): the real configuration folder of the developer is redirected to a temp folder before
    // any test code runs, and a run that changes the real folder FAILS.
    globalSetup: ['../../test-support/guardRealConfig.ts'],
    setupFiles: ['../../test-support/isolateEnv.ts'],
    include: ['src/**/*.test.ts'],
    // Timeouts are guards against a test that HANGS, never a performance limit: no test may fail because the machine is slow.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
