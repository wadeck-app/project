import { join } from 'node:path';

/** The updater cannot set itself up: reported to the user, never skipped. */
export class UpdaterSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdaterSetupError';
  }
}

const SELF_CHECK_HINT = 'no update was attempted, because an update that cannot be verified is not applied; fix npm (run: npm root -g) and retry with: project cli update';

/**
 * The command shared-updater runs after an install to verify the new version (a failing check rolls the update back).
 * It needs the global npm folder: when that cannot be found this throws instead of updating without verification.
 */
export function selfCheckCommand(npmRootGlobal: () => string, nodePath: string): string {
  let root: string;
  try {
    root = npmRootGlobal().trim();
  } catch (error) {
    throw new UpdaterSetupError(`cannot find the global npm folder (npm root -g failed: ${error instanceof Error ? error.message : String(error)}); ${SELF_CHECK_HINT}`);
  }
  if (root === '') {
    throw new UpdaterSetupError(`cannot find the global npm folder (npm root -g printed nothing); ${SELF_CHECK_HINT}`);
  }
  return `"${nodePath}" "${join(root, '@wadeck-app', 'project-cli', 'project.cjs')}" cli self-check`;
}
