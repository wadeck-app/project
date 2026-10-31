import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test-support/**/*.test.ts'],
    // The guard and the isolation protect the real configuration folder for the tests of this repository, including these.
    globalSetup: ['./test-support/guardRealConfig.ts'],
    setupFiles: ['./test-support/isolateEnv.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
