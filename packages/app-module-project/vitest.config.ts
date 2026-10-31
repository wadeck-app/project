import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    restoreMocks: true,
    // Mandatory, shared by every package (see test-support/): the real configuration folder of the developer is redirected to a temp folder before
    // any test code runs, and a run that changes the real folder FAILS.
    globalSetup: ['../../test-support/guardRealConfig.ts'],
    setupFiles: ['../../test-support/isolateEnv.ts', './src/backend/vitest.setup.ts'],
    // vitest.setup.ts: this module's own sandbox on top of the shared one (a registry folder for app-core-cli dev).
    include: ['src/**/*.test.ts'],
    // Timeouts are guards against a test that HANGS, never a performance limit: no test may fail because the machine is slow
    // (a Windows CI runner is several times slower than a laptop for file and process work).
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
