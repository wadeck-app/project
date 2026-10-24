import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Default registry directory: $XDG_CONFIG_HOME/project when set and non-blank, else <home>/.config/project
 * (`home` defaults to the home directory of the user; pass it explicitly in tests).
 * No override mechanism in version 1: callers pass the directory to every SDK function.
 */
export function defaultRegistryDir(env: NodeJS.ProcessEnv, home?: string): string {
  const xdg = env['XDG_CONFIG_HOME'];
  return xdg !== undefined && xdg.trim() !== '' ? join(xdg, 'project') : join(home ?? homedir(), '.config', 'project');
}
