import { logCliInvocation } from '@wadeck-app/shared-cli/CliLogger';
import { appendLog } from '@wadeck-app/shared-updater';

/** What one invocation of the CLI writes to <config folder>/logs/YYYY-MM-DD.ndjson, the file the updater writes to as well. */
export interface InvocationLog {
  /** How the project was found (the line also printed on stderr). */
  resolution: (line: string) => void;
  /** A change made to the registry: names and ids, never values or file contents. */
  mutation: (text: string) => void;
  /** How the invocation ended; a non-zero exit code is logged at error level, with the code of the error when it has one. */
  outcome: (exitCode: number, errorCode?: string) => void;
}

/** `https://user:token@host` becomes `https://***@host`: arguments such as a git URL may carry credentials. */
function redact(arg: string): string {
  return arg.replace(/(\w+:\/\/)[^\s/@]+@/g, '$1***@');
}

/**
 * Logs the invocation and returns the writer of the following entries. A log that cannot be written never blocks
 * the command, but it is not silent either: `warn` is called once, with the reason.
 */
export function openInvocationLog(configDir: string, argv: readonly string[], warn: (reason: string) => void): InvocationLog {
  let warned = false;
  const guarded = (write: () => void): void => {
    try {
      write();
    } catch (error) {
      if (!warned) {
        warned = true;
        warn(error instanceof Error ? error.message : String(error));
      }
    }
  };

  guarded(() => logCliInvocation(configDir, 'project', argv.map(redact)));
  return {
    resolution: (line) => guarded(() => appendLog(configDir, 'info', line)),
    mutation: (text) => guarded(() => appendLog(configDir, 'info', `mutation: ${text}`)),
    outcome: (exitCode, errorCode) =>
      guarded(() => appendLog(configDir, exitCode === 0 ? 'info' : 'error', `exit ${exitCode}${errorCode === undefined ? '' : ` (${errorCode})`}`)),
  };
}
