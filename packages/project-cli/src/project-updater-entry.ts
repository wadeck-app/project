// Entry point of the updater, bundled separately as project-updater.cjs. It must NOT import the CLI runtime (size limit, see ci/scripts/bundle.ts).
import { defaultRegistryDir } from '@wadeck-app/project-sdk';
import { cacheFilePath, execNpm, readCache, readState, runUpdater, stateFilePath, writeState } from '@wadeck-app/shared-updater';
import { runProjectUpdater } from './updater/runProjectUpdater.js';

// Injected by esbuild (define) in ci/scripts/bundle.ts; the updater is only ever built that way.
declare const __PROJECT_CLI_VERSION__: string | undefined;

if (typeof __PROJECT_CLI_VERSION__ !== 'string' || __PROJECT_CLI_VERSION__ === '') {
  process.stderr.write('[project-updater] fatal: this updater was built without a version (BUNDLE_VERSION); rebuild it with: npm run bundle\n');
  process.exit(1);
}

// The same folder as the registry: the state, cache and logs of the updater live next to registry.json.
const configDir = defaultRegistryDir(process.env);
const cacheFile = cacheFilePath(configDir);
const stateFile = stateFilePath(configDir);

runProjectUpdater({
  env: process.env,
  configDir,
  version: __PROJECT_CLI_VERSION__,
  nodePath: process.execPath,
  npmRootGlobal: () => execNpm(['root', '-g'], { timeout: 10_000 }),
  runUpdater,
  readCache: () => readCache(cacheFile),
  readState: () => readState(stateFile),
  cacheFile,
  stateFile,
  writeState: (state) => writeState(stateFile, state),
  now: () => Date.now(),
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
}).then((code) => {
  process.exitCode = code;
});
