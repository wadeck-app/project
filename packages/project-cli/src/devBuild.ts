import type { UpdateManager } from '@wadeck-app/shared-cli';
import { CliError } from './errors.js';

// What CI stamps: YYYY.M.D-NNN-<8 hex>, with the build number zero-padded to at least 3 digits. Strict on purpose: taking a development
// build for a release lets it run `npm install -g` over the real installation, taking a release for a development build only refuses loudly.
const STAMPED = /^\d{4}\.\d{1,2}\.\d{1,2}-\d{3,}-[0-9a-f]{8}$/;

export function isStampedVersion(version: string): boolean {
  return STAMPED.test(version);
}

/** A repo-built CLI (any version that CI did not stamp) must never replace or roll back the global install. */
export function assertReleaseBuild(version: string, command: 'update' | 'rollback'): void {
  if (!isStampedVersion(version)) {
    throw new CliError(
      `this is a development build (version ${version}, not a stamped release): 'project cli ${command}' would replace the global install of @wadeck-app/project-cli. ` +
        `Install the published package (npm i -g @wadeck-app/project-cli) and run its 'project cli ${command}', or run the stamped bundle`,
    );
  }
}

/** Starts the detached background update, except for a development build. Returns whether it was started. */
export function scheduleBackgroundUpdate(options: { version: string; manager: Pick<UpdateManager, 'scheduleBackgroundUpdate'>; bundlePath: string; updaterName: string }): boolean {
  if (!isStampedVersion(options.version)) {
    return false;
  }
  options.manager.scheduleBackgroundUpdate(options.bundlePath, options.updaterName);
  return true;
}
