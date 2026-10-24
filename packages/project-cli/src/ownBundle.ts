import { fileURLToPath } from 'node:url';
import { resolveOwnBundlePath } from '@wadeck-app/shared-cli/resolveOwnBundlePath';

/** Basename of the bundle this CLI is shipped as, to tell its own LAUNCHER_BUNDLE_OVERRIDE from one leaked by another CLI's launcher. */
export const PROJECT_BUNDLE_NAME = 'project.cjs';
export const UPDATER_BUNDLE_NAME = 'project-updater.cjs';
export const PACKAGE_NAME = '@wadeck-app/project-cli';

/** Path of project.cjs when running bundled; the running file itself in a plain tsc build (where there is no updater next to it). */
export function ownBundlePath(): string {
  return resolveOwnBundlePath(PROJECT_BUNDLE_NAME, fileURLToPath(import.meta.url));
}
