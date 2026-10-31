import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    restoreMocks: true,
    // Points XDG_CONFIG_HOME, HOME and USERPROFILE at a temp folder for every test file: no test can touch the real registry.
    setupFiles: ['./src/backend/vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // Timeouts are guards against a test that HANGS, never a performance limit: no test may fail because the machine is slow
    // (a Windows CI runner is several times slower than a laptop for file and process work).
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
