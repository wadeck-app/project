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
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'project-cli-ws-')));
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
    cleanup: () => removeTempDir(root),
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
    // Windows keeps per-user settings (npm, caches) under these: the real ones must not be reachable either.
    ...(process.platform === 'win32' ? { APPDATA: join(root, 'home', 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'home', 'AppData', 'Local') } : {}),
    npm_config_prefix: join(root, 'npm-prefix'),
    npm_config_registry: 'http://127.0.0.1:9/',
    // A scoped registry in the real .npmrc beats the plain one for @wadeck-app packages: pin the scope too.
    'npm_config_@wadeck-app:registry': 'http://127.0.0.1:9/',
  };
}

/** Size and mtime of the REAL global install of the CLI (what an update or a rollback would replace). Read-only; `missing` when it is not installed. */
export function realGlobalInstallSnapshot(): string {
  // The real environment (APPDATA decides where the global npm folder is on Windows), not the redirected one.
  const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: withRealEnvironment() }).trim();
  const file = join(globalRoot, '@wadeck-app', 'project-cli', 'package.json');
  return existsSync(file) ? `${statSync(file).size}:${statSync(file).mtimeMs}` : 'missing';
}

/**
 * The real configuration folder of the developer, as recorded by the guard of the run (test-support/guardRealConfig.ts) BEFORE the environment of
 * the tests was redirected. defaultRegistryDir(process.env) would answer with the temp folder and a check on it would always pass.
 */
export function realConfigFolder(): string {
  const real = process.env['PROJECT_TEST_REAL_CONFIG_DIR'];
  if (real === undefined || real === '') {
    throw new Error('PROJECT_TEST_REAL_CONFIG_DIR is not set: the globalSetup guard of test-support/ must run (see globalSetup in vitest.config.ts); without it a check of the real folder would look at the temp one');
  }
  return real;
}

/** The REAL values (before the redirection) of the variables the isolation redirects, for a test that must look at the real machine read-only. */
export function realEnvironment(): Record<string, string> {
  const recorded = process.env['PROJECT_TEST_REAL_ENV'];
  if (recorded === undefined) {
    throw new Error('PROJECT_TEST_REAL_ENV is not set: the globalSetup guard of test-support/ must run (see globalSetup in vitest.config.ts)');
  }
  return JSON.parse(recorded) as Record<string, string>;
}

/** A copy of the environment of the process with the REAL values (before the redirection) of the redirected variables; those that were not set stay unset. */
export function withRealEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const name of ['XDG_CONFIG_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'APP_CORE_CONFIG_DIR', 'APP_CORE_PORT']) {
    delete copy[name];
  }
  return { ...copy, ...realEnvironment() };
}

/**
 * Whether the REAL log of the CLI (today and yesterday, UTC) mentions the token. A process that logged an argument carrying a unique token
 * used the real config folder; real sessions using the CLI at the same time cannot produce the token, which makes this free of races.
 */
export function realLogMentions(token: string): boolean {
  const configDir = realConfigFolder();
  return [0, 1].some((daysAgo) => {
    const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const file = join(configDir, 'logs', `${day}.ndjson`);
    return existsSync(file) && readFileSync(file, 'utf8').includes(token);
  });
}

// Lines that npm and node print on their own, whatever the code under test does: `npm warn ...` (setup-node writes an npmrc with keys
// the installed npm does not know, "Unknown user config"), deprecation / experimental warnings of node and the debugger.
const NOISE = [/^npm warn(\s|$)/, /^\(node:\d+\) /, /^\(Use `node --trace-/, /^Debugger attached/, /^Waiting for the debugger/, /^Debugger listening/];

/** The stderr of a child process without the noise of npm and node: real errors and the output of the code under test are kept as they are. */
export function significantStderr(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !NOISE.some((pattern) => pattern.test(line)))
    .join('\n')
    .replace(/\s+$/, '');
}

/**
 * Removes a temp folder at the end of a test. Windows (and antivirus) can refuse for a moment while a handle is still open (EPERM,
 * EBUSY): the removal retries 20 times, 100 ms apart. A folder that still cannot be removed is a warning with its name, never a failed test.
 */
export function removeTempDir(
  dir: string,
  options: { remove?: (path: string, options: { recursive: boolean; force: boolean; maxRetries: number; retryDelay: number }) => void; warn?: (text: string) => void } = {},
): void {
  const { remove = rmSync, warn = (text: string) => void process.stderr.write(text) } = options;
  try {
    remove(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    warn(`[tests] could not remove the temp folder ${dir} (${error instanceof Error ? error.message : String(error)}); delete it by hand\n`);
  }
}

/**
 * The bash the tests run the ci scripts with. On a Windows machine `bash` can be the launcher of WSL (C:\Windows\System32\bash.exe, no
 * distribution installed on a CI runner) found before the bash of Git: the scripts need the latter (cygpath, MSYS paths). Elsewhere: `bash`.
 */
export function bashCommand(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string {
  if (platform !== 'win32') {
    return 'bash';
  }
  const roots = [env['ProgramFiles'], env['ProgramW6432'], env['ProgramFiles(x86)']].filter((root): root is string => root !== undefined && root !== '');
  for (const root of roots) {
    for (const relative of [['Git', 'bin', 'bash.exe'], ['Git', 'usr', 'bin', 'bash.exe']]) {
      const candidate = join(root, ...relative);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return 'bash';
}
