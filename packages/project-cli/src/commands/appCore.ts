// project cli register | unregister -- tell app-core where the project app-module lives, or remove it.
import { type AppCoreAttempt, attemptStagedRegistration, attemptUnregistration } from '../AppCoreRegistration.js';
import { resolveAppModuleManifest } from '../appModuleManifest.js';
import type { CommandOutput, PlainCommand } from '../command.js';
import { CliError } from '../errors.js';

/**
 * Exit 0 when app-core took it, or is absent / not running (`deferred`, `skipped`: nothing to fix, said clearly). `unconfirmed`
 * (app-core is up but did not answer in time, it may have applied the call) is exit 0 too: nothing is known to be wrong, and a
 * script that needs certainty tests `status` in --json. Exit 1 with the reason when app-core refuses or the call fails.
 */
function outputOf(attempt: AppCoreAttempt): CommandOutput {
  if (!attempt.ok) {
    throw new CliError(attempt.message);
  }
  return { json: { ok: true, status: attempt.status, message: attempt.message }, lines: [attempt.message] };
}

export const registerCommand: PlainCommand = {
  name: 'cli register',
  summary: 'Show the project pages in app-core. This is the first registration: only this command does it; updates then keep it current',
  target: 'none',
  args: [],
  options: {},
  run: async () => {
    let manifestPath: string;
    try {
      manifestPath = resolveAppModuleManifest();
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : String(error));
    }
    return outputOf(await attemptStagedRegistration(manifestPath));
  },
};

export const unregisterCommand: PlainCommand = {
  name: 'cli unregister',
  summary: 'Remove the project pages from app-core, and stop the updates from registering them again',
  target: 'none',
  args: [],
  options: {},
  run: async () => outputOf(await attemptUnregistration()),
};
