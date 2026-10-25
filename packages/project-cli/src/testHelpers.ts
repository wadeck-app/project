import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRegistryDir, normalizePath, toNativePath } from '@wadeck-app/project-sdk';
import { run } from './run.js';

export interface Outcome {
  code: number;
  out: string;
  err: string;
}

export interface Harness {
  registryDir: string;
  /** Environment that redirects the registry into the temporary root. */
  env: NodeJS.ProcessEnv;
  /** Creates (if needed) a work folder and returns its normalized path. */
  dir: (name: string) => string;
  /** Runs the CLI in-process, cwd defaults to the work folder root. */
  cli: (argv: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<Outcome>;
  cleanup: () => void;
}

/** Test-only (excluded from the build): a real temporary registry and work folders; call cleanup() in afterEach. */
export function makeHarness(): Harness {
  // Real path on purpose: on macOS the temporary directory is a symlink (/var -> /private/var).
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-cli-ws-')));
  const workRoot = join(root, 'work');
  mkdirSync(workRoot, { recursive: true });
  const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: join(root, 'xdg') };
  return {
    registryDir: join(root, 'xdg', 'project'),
    env,
    dir: (name) => {
      const path = join(workRoot, name);
      mkdirSync(path, { recursive: true });
      return normalizePath(path);
    },
    cli: async (argv, options = {}) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) }, { ...env, ...options.env }, options.cwd ?? workRoot);
      return { code, out: out.join('\n'), err: err.join('\n') };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A stored path as the CLI prints it for people: backslashes on Windows (see toNativePath in the SDK). */
export const native = (path: string): string => toNativePath(path);

/**
 * The environment for a CLI process under test: its own registry/config folder, home, global npm prefix and an unreachable npm registry,
 * with the automatic update switched off. Nothing it starts can reach the real ~/.config/project or the real global npm.
 */
export function isolatedCliEnv(root: string): NodeJS.ProcessEnv {
  const { PROJECT_PROJECT: _inherited, ...inherited } = process.env;
  mkdirSync(join(root, 'xdg', 'project'), { recursive: true });
  writeFileSync(join(root, 'xdg', 'project', 'config.yml'), 'autoUpdate: false\n');
  return {
    ...inherited,
    XDG_CONFIG_HOME: join(root, 'xdg'),
    HOME: join(root, 'home'),
    USERPROFILE: join(root, 'home'),
    npm_config_prefix: join(root, 'npm-prefix'),
    npm_config_registry: 'http://127.0.0.1:9/',
  };
}

/** Size and mtime of what an update or a rollback would write in the REAL environment: the global install of the CLI and the real update files. Read-only. */
export function realStateSnapshot(): Record<string, string> {
  const describe = (file: string): string => (existsSync(file) ? `${statSync(file).size}:${statSync(file).mtimeMs}` : 'missing');
  const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const configDir = defaultRegistryDir(process.env);
  return {
    'global package.json': describe(join(globalRoot, '@wadeck-app', 'project-cli', 'package.json')),
    'update-state.json': describe(join(configDir, 'update-state.json')),
    'update-cache.json': describe(join(configDir, 'update-cache.json')),
    'update-notice-shown.json': describe(join(configDir, 'update-notice-shown.json')),
    'update.lock': describe(join(configDir, 'update.lock')),
  };
}
