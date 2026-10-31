import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll } from 'vitest';

// The module reads the shared project registry at every request, from $XDG_CONFIG_HOME/project, else <home>/.config/project, and it
// writes it. Point all three variables at a temp folder for every test file (child processes inherit them): no test can read or
// write the real registry. A test that needs a registry creates one in that folder (or in its own temp folder) with the SDK.
// The real registry folder (before the override) and a fingerprint of its files, for the test that proves it is never touched.
const realXdg = process.env['XDG_CONFIG_HOME'];
const realDir = realXdg !== undefined && realXdg.trim() !== '' ? path.join(realXdg, 'project') : path.join(os.homedir(), '.config', 'project');
function fingerprint(dir: string): string {
  if (!fs.existsSync(dir)) {
    return 'absent';
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `${name}:${fs.statSync(path.join(dir, name)).mtimeMs}:${fs.statSync(path.join(dir, name)).size}`)
    .join('|');
}
process.env['PROJECT_TEST_REAL_REGISTRY_DIR'] = realDir;
process.env['PROJECT_TEST_REAL_REGISTRY_FINGERPRINT'] = fingerprint(realDir);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'project-module-xdg-'));
process.env['XDG_CONFIG_HOME'] = sandbox;
process.env['HOME'] = sandbox;
process.env['USERPROFILE'] = sandbox;
// The ports of app-core are never read from the developer's machine either.
delete process.env['APP_CORE_PORT'];
process.env['APP_CORE_CONFIG_DIR'] = path.join(sandbox, 'app-core');

// `app-core-cli package|dev` (real-server test) schedules a DETACHED background updater that reads <XDG_CONFIG_HOME>/app-core-cli/config.yml.
// Without `autoUpdate: false` it would run a real `npm install -g` of app-core-cli on the developer's machine.
fs.mkdirSync(path.join(sandbox, 'app-core-cli'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'app-core-cli', 'config.yml'), 'autoUpdate: false\n');

afterAll(() => {
  // Windows can refuse to remove a folder for a moment (antivirus, indexer): retry, and never fail a suite over a temp folder.
  try {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    process.stderr.write(`[vitest.setup] could not remove ${sandbox}, delete it by hand (${error instanceof Error ? error.message : String(error)})\n`);
  }
});
