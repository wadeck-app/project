import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Records a change of the registry in the daily log of the registry folder (`logs/YYYY-MM-DD.ndjson`, the file and the format of the
 * `project` CLI and of its updater), so that a change made from the UI is as traceable as one made from the command line.
 * Names and ids only, never values. A log that cannot be written never blocks the change, it is said on stderr.
 */
export function logMutation(registryDir: string, text: string): void {
  try {
    const file = join(registryDir, 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`);
    mkdirSync(join(registryDir, 'logs'), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: `mutation: ${text} (via the project module)` })}\n`);
  } catch (error) {
    process.stderr.write(`[project module] could not write the log (${error instanceof Error ? error.message : String(error)})\n`);
  }
}
