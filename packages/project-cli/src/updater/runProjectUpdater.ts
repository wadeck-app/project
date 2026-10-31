import type { UpdateCache, UpdateState, UpdaterConfig } from '@wadeck-app/shared-updater';
import { devBuildRefusalMessage, isReleaseVersion } from '@wadeck-app/shared-cli/ReleaseVersion';
import { join } from 'node:path';
import { type AppModuleVersion, registerAfterUpdate } from '../registerAfterUpdate.js';
import { describeOutcome } from './outcome.js';
import { selfCheckCommand } from './selfCheckCommand.js';

export const PKG_NAME = '@wadeck-app/project-cli';

/**
 * What this updater knows how to do, written in the log file at each decision and therefore present in the bundle: the install check
 * (ci/scripts/verify-update.sh) greps the updater of the PREVIOUS version for it, because it is that updater, not the new one, that
 * registers after an update.
 */
export const UPDATER_CAPABILITIES = 'reregister-on-update:v1';

/** What the updater needs to tell app-core about new pages (fakes in tests, the real files and the app-core SDK in the entry point). */
export interface AppModuleDeps {
  readVersion: (manifestPath: string) => AppModuleVersion;
  register: (manifestPath: string, log: (entry: { source: string; message: string }) => void) => Promise<void>;
  /** Whether the user registered the module (a staged copy exists). Read before the install. */
  isRegistered: () => boolean;
}

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
  /** A line of the log file of the CLI (<registry folder>/logs/YYYY-MM-DD.ndjson), the same one as the update messages. */
  appendLog: (level: 'info' | 'warn' | 'error', text: string) => void;
  appModule: AppModuleDeps;
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
  if (!isReleaseVersion(deps.version)) {
    stderr(`[project-updater] ${devBuildRefusalMessage('project', deps.version)}`);
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

  // A running app-core holds the previous pages until told: compare the app-module before and after the install.
  const appModule = prepareAppModule(deps);
  let crash: unknown;
  try {
    await deps.runUpdater({
      pkgName: PKG_NAME,
      configDir: deps.configDir,
      currentVersion: deps.version,
      strategy: 'without-daemon',
      onUpdateAvailable: async () => 'apply-now' as const,
    });
  } catch (error) {
    crash = error;
  }
  // Also after a crash: the files may have been replaced before it (an unchanged version registers nothing).
  await appModule();
  if (force) {
    reportOutcome();
  }
  if (crash !== undefined) {
    stderr(`[project-updater] fatal: ${String(crash)}`);
    return 1;
  }
  return 0;
}

/** Reads the installed app-module now; the returned function registers it if it changed. Never throws, nothing silent. */
function prepareAppModule(deps: UpdaterDeps): () => Promise<void> {
  const unknown = (reason: string): (() => Promise<void>) => async () => {
    const text = `app-core: not re-registering the app-module, ${reason}. Once fixed, run: project cli register`;
    deps.stderr(`[project-updater] ${text}`);
    deps.appendLog('warn', text);
  };
  let manifestPath: string;
  try {
    // trim(): `npm root -g` answers with a line break (execNpm returns it as it is), which made the path of the manifest wrong for every real run.
    manifestPath = join(deps.npmRootGlobal().trim(), PKG_NAME, 'app-module', 'manifest.json');
  } catch (error) {
    return unknown(`the global npm folder is unknown (${error instanceof Error ? error.message : String(error)})`);
  }
  const before = deps.appModule.readVersion(manifestPath);
  const registered = deps.appModule.isRegistered();
  // A decision for the person (stderr) and for the log file; a decision that needs no reader goes to the log file only.
  const note = (line: string): void => deps.appendLog('info', `${line} [${UPDATER_CAPABILITIES}]`);
  return async () => {
    try {
      await registerAfterUpdate({
        registered,
        manifestPath,
        before,
        readVersion: deps.appModule.readVersion,
        register: deps.appModule.register,
        log: (line) => {
          deps.stderr(`[project-updater] ${line}`);
          note(line);
        },
        note,
      });
    } catch (error) {
      const text = `app-core: registration after the update failed (${error instanceof Error ? error.message : String(error)}). Run: project cli register`;
      deps.stderr(`[project-updater] ${text}`);
      deps.appendLog('error', text);
    }
  };
}
