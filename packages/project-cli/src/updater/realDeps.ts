import { defaultRegistryDir } from '@wadeck-app/project-sdk';
import { appendLog, cacheFilePath, execNpm, readCache, readState, runUpdater, stateFilePath, writeState } from '@wadeck-app/shared-updater';
import { registerWithAppCore } from '../AppCoreRegistration.js';
import { hasStagedModule } from '../appModuleStaging.js';
import { readAppModuleVersion } from '../registerAfterUpdate.js';
import type { UpdaterDeps } from './runProjectUpdater.js';

// Imported by the updater bundle (500 KB guard): the real wiring, nothing of the CLI runtime.

/** The folder of the updater: the same as the registry, its state, cache and logs live next to registry.json. */
export const updaterConfigDir = (env: NodeJS.ProcessEnv): string => defaultRegistryDir(env);

/** The dependencies of the updater as they are in production. Tests replace `runUpdater` (the install) and the writers, nothing else. */
export function realUpdaterDeps(env: NodeJS.ProcessEnv, configDir: string, version: string): UpdaterDeps {
  const cacheFile = cacheFilePath(configDir);
  const stateFile = stateFilePath(configDir);
  return {
    env,
    configDir,
    version,
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
    appendLog: (level, text) => appendLog(configDir, level, text),
    appModule: { readVersion: readAppModuleVersion, register: registerWithAppCore, isRegistered: () => hasStagedModule(configDir) },
  };
}
