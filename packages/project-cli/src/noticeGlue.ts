import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateManager, UpdateState } from '@wadeck-app/shared-cli';
import { COMMANDS } from './commands/index.js';
import { splitCommand } from './dispatch.js';
import { isPidAlive as defaultIsPidAlive } from './pidAlive.js';
import { interruptedUpdateLine, updateNoticeLines } from './updateNotice.js';

/** An update that has been 'applying' for longer than this was interrupted, whatever the pid says (pids are reused). */
const INTERRUPTED_AFTER_MS = 15 * 60_000;

export interface NoticeDeps {
  configDir: string;
  argv: readonly string[];
  manager: UpdateManager;
  print: (line: string) => void;
  warn: (message: string) => void;
  isPidAlive?: (pid: number) => boolean;
  now?: () => number;
}

type RawState = { timestamp?: unknown; pid?: unknown } & Partial<UpdateState>;

function readJson(file: string): RawState | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RawState;
  } catch {
    // No file, or one that is not JSON: there is nothing to announce (shared-cli reads such a state as none as well).
    return null;
  }
}

/**
 * An 'applying' state is written by the updater before it runs `npm install -g`. It is still running when its pid is alive and
 * the state is recent; otherwise the updater died inside the install. Without a pid only the age can tell.
 */
function isInterrupted(state: RawState, deps: Required<Pick<NoticeDeps, 'isPidAlive' | 'now'>>): boolean {
  const age = typeof state.timestamp === 'number' ? deps.now() - state.timestamp : Number.POSITIVE_INFINITY;
  if (age > INTERRUPTED_AFTER_MS) {
    return true;
  }
  return typeof state.pid === 'number' && !deps.isPidAlive(state.pid);
}

/**
 * Tells what the background updater did since the last command.
 *
 * `project cli rollback` skips the notice: shared-cli reads and clears update-state.json, the only place that remembers
 * the previous version, so reading it first would leave nothing to roll back to.
 * For the same reason a successful update is not cleared: the notice is shown once, which a sidecar file remembers
 * (by timestamp), and `cli rollback` stays possible until the next update. Failures keep print-once-and-clear.
 * An interrupted update ('applying' whose updater is gone) is announced once the same way and never cleared: the next updater run repairs it.
 */
export function showUpdateNotice(deps: NoticeDeps): void {
  const { configDir, argv, manager, print, warn } = deps;
  if (splitCommand(argv, COMMANDS.map((c) => c.name)).name === 'cli rollback') {
    return;
  }
  const stateFile = join(configDir, 'update-state.json');
  const shownFile = join(configDir, 'update-notice-shown.json');
  const raw = readJson(stateFile);

  const announceOnce = (lines: string[]): void => {
    if (raw?.timestamp !== undefined && readJson(shownFile)?.timestamp === raw.timestamp) {
      return;
    }
    lines.forEach(print);
    try {
      writeFileSync(shownFile, JSON.stringify({ timestamp: raw?.timestamp }));
    } catch (error) {
      warn(`warning: could not remember that the update notice was shown (${error instanceof Error ? error.message : String(error)})`);
    }
  };

  if (raw?.status === 'applying') {
    // Left in place whatever it is: an update that is running must not be disturbed, an interrupted one is for the updater to repair.
    if (isInterrupted(raw, { isPidAlive: deps.isPidAlive ?? defaultIsPidAlive, now: deps.now ?? Date.now })) {
      announceOnce([interruptedUpdateLine(raw as UpdateState)]);
    }
    return;
  }
  if (raw?.status === 'success') {
    announceOnce(updateNoticeLines(raw as UpdateState));
    return;
  }
  updateNoticeLines(manager.readAndClearState()).forEach(print);
}
