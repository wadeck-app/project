import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
    // A scoped registry in the real .npmrc beats the plain one for @wadeck-app packages: pin the scope too.
    'npm_config_@wadeck-app:registry': 'http://127.0.0.1:9/',
  };
}

/** Size and mtime of the REAL global install of the CLI (what an update or a rollback would replace). Read-only; `missing` when it is not installed. */
export function realGlobalInstallSnapshot(): string {
  const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const file = join(globalRoot, '@wadeck-app', 'project-cli', 'package.json');
  return existsSync(file) ? `${statSync(file).size}:${statSync(file).mtimeMs}` : 'missing';
}

/**
 * Whether the REAL log of the CLI (today and yesterday, UTC) mentions the token. A process that logged an argument carrying a unique token
 * used the real config folder; real sessions using the CLI at the same time cannot produce the token, which makes this free of races.
 */
export function realLogMentions(token: string): boolean {
  const configDir = defaultRegistryDir(process.env);
  return [0, 1].some((daysAgo) => {
    const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const file = join(configDir, 'logs', `${day}.ndjson`);
    return existsSync(file) && readFileSync(file, 'utf8').includes(token);
  });
}
