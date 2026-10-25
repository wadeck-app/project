import type { UpdateState } from '@wadeck-app/shared-cli';

/**
 * What to tell the user about the background update run that happened since the last command.
 * The statuses are those of shared-cli's UpdateManager, which already maps the legacy 'update-failed' to 'failed'.
 */
export function updateNoticeLines(state: UpdateState | null): string[] {
  switch (state?.status) {
    case 'success':
      return [`[project] Updated to v${state.targetVersion ?? state.newVersion}${state.previousVersion === undefined ? '' : ` (was v${state.previousVersion}). To go back: project cli rollback`}`];
    case 'rolled-back':
      return [`[project] Update to v${state.targetVersion} failed (self-check failed). Rolled back to v${state.previousVersion}. Run: project cli logs`];
    case 'failed':
      return [`[project] Background update failed (${state.error ?? 'no reason recorded'}). Run: project cli update`];
    default:
      return [];
  }
}

/** An update that was cut short inside the install: the state says what was being installed and what to go back to. */
export function interruptedUpdateLine(state: Pick<UpdateState, 'targetVersion' | 'previousVersion'>): string {
  return `[project] An update to v${state.targetVersion} was interrupted (previous version v${state.previousVersion}). Repair it with: project cli update`;
}
