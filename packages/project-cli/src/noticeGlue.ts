import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateManager, UpdateState } from '@wadeck-app/shared-cli';
import { COMMANDS } from './commands/index.js';
import { splitCommand } from './dispatch.js';
import { updateNoticeLines } from './updateNotice.js';

export interface NoticeDeps {
  configDir: string;
  argv: readonly string[];
  manager: UpdateManager;
  print: (line: string) => void;
  warn: (message: string) => void;
}

function readJson(file: string): { timestamp?: unknown } & Partial<UpdateState> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { timestamp?: unknown } & Partial<UpdateState>;
  } catch {
    // No file, or one that is not JSON: there is nothing to announce (shared-cli reads such a state as none as well).
    return null;
  }
}

/**
 * Tells what the background updater did since the last command.
 *
 * `project cli rollback` skips the notice: shared-cli reads and clears update-state.json, the only place that remembers
 * the previous version, so reading it first would leave nothing to roll back to.
 * For the same reason a successful update is not cleared: the notice is shown once, which a sidecar file remembers
 * (by timestamp), and `cli rollback` stays possible until the next update. Failures keep print-once-and-clear.
 */
export function showUpdateNotice(deps: NoticeDeps): void {
  const { configDir, argv, manager, print, warn } = deps;
  if (splitCommand(argv, COMMANDS.map((c) => c.name)).name === 'cli rollback') {
    return;
  }
  const stateFile = join(configDir, 'update-state.json');
  const shownFile = join(configDir, 'update-notice-shown.json');
  const raw = readJson(stateFile);
  if (raw?.status !== 'success') {
    updateNoticeLines(manager.readAndClearState()).forEach(print);
    return;
  }
  if (raw.timestamp !== undefined && readJson(shownFile)?.timestamp === raw.timestamp) {
    return;
  }
  updateNoticeLines(raw as UpdateState).forEach(print);
  try {
    writeFileSync(shownFile, JSON.stringify({ timestamp: raw.timestamp }));
  } catch (error) {
    warn(`warning: could not remember that the update notice was shown (${error instanceof Error ? error.message : String(error)})`);
  }
}
