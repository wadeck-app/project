import type { UpdateState } from '@wadeck-app/shared-cli';

/**
 * What to tell the user about the background update run that happened since the last command.
 * The statuses are those of shared-cli's UpdateManager, which already maps the legacy 'update-failed' to 'failed'.
 */
export function updateNoticeLines(state: UpdateState | null): string[] {
  switch (state?.status) {
    case 'success':
      return [`[project] Updated to v${state.targetVersion ?? state.newVersion}`];
    case 'rolled-back':
      return [`[project] Update to v${state.targetVersion} failed (self-check failed). Rolled back to v${state.previousVersion}. Run: project cli logs`];
    case 'failed':
      return [`[project] Background update failed (${state.error ?? 'no reason recorded'}). Run: project cli update`];
    default:
      return [];
  }
}
