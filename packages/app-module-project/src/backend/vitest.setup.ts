import { tmpdir } from 'node:os';
import { relative } from 'node:path';

// The isolation itself is the shared test-support/isolateEnv.ts (listed before this file in vitest.config.ts): XDG_CONFIG_HOME, HOME, USERPROFILE,
// APPDATA, LOCALAPPDATA and APP_CORE_CONFIG_DIR point into a temp folder and APP_CORE_PORT is an unused port. This module reads and WRITES the
// shared registry at every request and talks to app-core, so it checks that the isolation is in place instead of trusting the order of the setup
// files: a mistake in the config fails here, at once, naming the variable, before any test can touch the real folders.
for (const name of ['XDG_CONFIG_HOME', 'HOME', 'USERPROFILE', 'APP_CORE_CONFIG_DIR']) {
  const value = process.env[name];
  if (value === undefined || relative(tmpdir(), value).startsWith('..')) {
    throw new Error(`${name} is ${JSON.stringify(value)}, not a temp folder: test-support/isolateEnv.ts must run before the tests (see setupFiles in vitest.config.ts)`);
  }
}
if (process.env['APP_CORE_PORT'] === undefined || process.env['APP_CORE_PORT'] === '4850') {
  throw new Error(`APP_CORE_PORT is ${JSON.stringify(process.env['APP_CORE_PORT'])}: tests must never use the port of the real app-core (4850)`);
}
