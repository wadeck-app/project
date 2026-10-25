import type { UpdateCache, UpdateState, UpdaterConfig } from '@wadeck-app/shared-updater';
import { isStampedVersion } from '../devBuild.js';
import { describeOutcome } from './outcome.js';
import { selfCheckCommand } from './selfCheckCommand.js';

export const PKG_NAME = '@wadeck-app/project-cli';

/** Everything the updater touches outside its own logic, so it can be run against fakes. */
export interface UpdaterDeps {
  /** process.env: shared-updater reads UPDATER_SELF_CHECK_CMD and UPDATER_FORCE from it. */
  env: NodeJS.ProcessEnv;
  configDir: string;
  version: string;
  nodePath: string;
  npmRootGlobal: () => string;
  runUpdater: (config: UpdaterConfig) => Promise<void>;
  readCache: () => UpdateCache | null;
  readState: () => UpdateState | null;
  /** Where the cache and the state live, for the messages. */
  cacheFile: string;
  stateFile: string;
  writeState: (state: UpdateState) => void;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * The background (or `project cli update`) update run; returns the exit code.
 * UPDATER_FORCE=1 means the user asked for it: the outcome is then printed, never silent.
 */
export async function runProjectUpdater(deps: UpdaterDeps): Promise<number> {
  const { env, stdout, stderr } = deps;
  const force = env['UPDATER_FORCE'] === '1';
  const startedAt = deps.now();

  // A repo-built updater must never touch the global install (an interrupted `npm install -g` can leave the CLI uninstalled).
  if (!isStampedVersion(deps.version)) {
    stderr(`[project-updater] fatal: development build (version ${deps.version}, not a stamped release): refusing to update the global install of ${PKG_NAME}`);
    return 1;
  }

  const reportOutcome = (): void => {
    for (const line of describeOutcome({ currentVersion: deps.version, startedAt, cache: deps.readCache(), state: deps.readState(), cacheFile: deps.cacheFile, stateFile: deps.stateFile })) {
      stdout(line);
    }
  };

  if (!env['UPDATER_SELF_CHECK_CMD']) {
    try {
      env['UPDATER_SELF_CHECK_CMD'] = selfCheckCommand(deps.npmRootGlobal, deps.nodePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr(`[project-updater] fatal: ${message}`);
      // Nobody watches a background run: the next command shows this failure through the update notice.
      deps.writeState({ status: 'failed', currentVersion: deps.version, error: message, timestamp: deps.now() });
      return 1;
    }
  }

  try {
    await deps.runUpdater({
      pkgName: PKG_NAME,
      configDir: deps.configDir,
      currentVersion: deps.version,
      strategy: 'without-daemon',
      onUpdateAvailable: async () => 'apply-now' as const,
    });
  } catch (error) {
    if (force) {
      reportOutcome();
    }
    stderr(`[project-updater] fatal: ${String(error)}`);
    return 1;
  }
  if (force) {
    reportOutcome();
  }
  return 0;
}
