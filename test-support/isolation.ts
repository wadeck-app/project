import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Mandatory setup file of every vitest config of the repository. BEFORE any test code runs, everything that decides where the tools look for
 * the user's configuration points into a fresh temp folder, and app-core's port is a port where nothing listens (never 4850): a test that
 * forgets to isolate itself reaches the temp folder, not the real registry, the staged module of the real app-core or the real app-core.
 * A test that needs its own folders keeps overriding the variables for itself.
 */

/** The variables the redirection sets. */
export const REDIRECTED_VARIABLES = ['XDG_CONFIG_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'APP_CORE_CONFIG_DIR', 'APP_CORE_PORT'] as const;

export interface Isolation {
  /** The temp folder everything points into. */
  dir: string;
  port: number;
  /** Puts the previous values back and removes the folder (retries: Windows can refuse for a moment). */
  restore: () => void;
}

/** A port on which nothing listens. */
export async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export async function isolateEnvironment(env: NodeJS.ProcessEnv = process.env, parent: string = tmpdir()): Promise<Isolation> {
  const dir = mkdtempSync(join(parent, 'project-test-env-'));
  const port = await unusedPort();
  const previous = Object.fromEntries(REDIRECTED_VARIABLES.map((name) => [name, env[name]]));
  mkdirSync(join(dir, 'xdg'), { recursive: true });
  mkdirSync(join(dir, 'home', 'AppData', 'Roaming'), { recursive: true });
  mkdirSync(join(dir, 'home', 'AppData', 'Local'), { recursive: true });
  env['XDG_CONFIG_HOME'] = join(dir, 'xdg');
  env['HOME'] = join(dir, 'home');
  env['USERPROFILE'] = join(dir, 'home');
  env['APPDATA'] = join(dir, 'home', 'AppData', 'Roaming');
  env['LOCALAPPDATA'] = join(dir, 'home', 'AppData', 'Local');
  env['APP_CORE_CONFIG_DIR'] = join(dir, 'app-core');
  env['APP_CORE_PORT'] = String(port);
  // app-core-cli schedules a detached updater from its config folder: without this it could install a real app-core-cli globally.
  mkdirSync(join(dir, 'xdg', 'app-core-cli'), { recursive: true });
  writeFileSync(join(dir, 'xdg', 'app-core-cli', 'config.yml'), 'autoUpdate: false\n');
  return {
    dir,
    port,
    restore() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete env[name];
        else env[name] = value;
      }
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      } catch (error) {
        process.stderr.write(`[test-support] could not remove ${dir} (${error instanceof Error ? error.message : String(error)}); delete it by hand\n`);
      }
    },
  };
}
