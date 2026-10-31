import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    restoreMocks: true,
    // Points XDG_CONFIG_HOME, HOME and USERPROFILE at a temp folder for every test file: no test can touch the real registry.
    setupFiles: ['./src/backend/vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // The real-server test spawns app-core and packages the module: it has its own, longer timeouts.
    testTimeout: 15_000,
  },
});
