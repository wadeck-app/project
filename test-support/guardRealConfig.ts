import { appendFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Guard of the test runs (vitest `globalSetup`): the real configuration folder of the developer, `~/.config/project`, must be exactly as it was
 * when the run ends. It holds the registry, but also the staged copy of the app-core module that the REAL app-core loads: a test that removed
 * it (the unregistration did) broke the pages of every module in the user's app-core, and nothing noticed because only a few files were compared.
 *
 * It runs in the main process of vitest, before any worker: the environment is still the real one there.
 */

export interface Entry {
  kind: 'file' | 'dir' | 'other';
  size: number;
  mtimeMs: number;
}

export type Fingerprint = Map<string, Entry>;

/** The folder of the registry as the tools resolve it for a real user: `$XDG_CONFIG_HOME/project`, else `<home>/.config/project`. */
export function realConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const xdg = env['XDG_CONFIG_HOME'];
  return xdg !== undefined && xdg.trim() !== '' ? join(xdg, 'project') : join(home, '.config', 'project');
}

/** Relative path, kind, size and time of everything under `dir` (recursively, symlinks not followed). `undefined` when the folder does not exist. */
export function fingerprintTree(dir: string): Fingerprint | undefined {
  if (!existsSync(dir)) {
    return undefined;
  }
  const result: Fingerprint = new Map();
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        // Gone between the listing and the stat: that is a change too, and the next fingerprint will not have it.
        continue;
      }
      result.set(relative, { kind: stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other', size: stat.size, mtimeMs: stat.mtimeMs });
      if (stat.isDirectory()) {
        walk(path, relative);
      }
    }
  };
  walk(dir, '');
  return result;
}

/** What differs between two fingerprints, one line per path: `removed`, `added` or `changed`. Empty when nothing differs. */
export function diffFingerprints(before: Fingerprint, after: Fingerprint): string[] {
  const lines: string[] = [];
  for (const [path, entry] of before) {
    const now = after.get(path);
    if (now === undefined) {
      lines.push(`removed: ${path}`);
    } else if (now.kind !== entry.kind || now.size !== entry.size || now.mtimeMs !== entry.mtimeMs) {
      lines.push(`changed: ${path} (size ${entry.size} -> ${now.size}, modified ${new Date(entry.mtimeMs).toISOString()} -> ${new Date(now.mtimeMs).toISOString()})`);
    }
  }
  for (const path of after.keys()) {
    if (!before.has(path)) {
      lines.push(`added: ${path}`);
    }
  }
  return lines.sort();
}

export interface Guard {
  /** Takes the fingerprint; call before any test runs. */
  start: () => void;
  /** Takes it again and throws, naming what changed and which test ran last, when it differs. */
  finish: () => void;
}

export interface GuardOptions {
  /** The folder to protect. */
  realDir: string;
  /** Files written by the workers (see isolateEnv.ts): the last test that started, and every test file that started. */
  lastTestFile: string;
  startedFilesFile: string;
}

function readIfThere(file: string): string {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

export function createGuard(options: GuardOptions): Guard {
  let before: Fingerprint | undefined;
  let existed = false;
  return {
    start() {
      before = fingerprintTree(options.realDir);
      existed = before !== undefined;
    },
    finish() {
      const after = fingerprintTree(options.realDir);
      let changes: string[];
      if (!existed) {
        changes = after === undefined ? [] : [`the folder ${options.realDir} did not exist when the run started and exists now`];
      } else if (after === undefined) {
        changes = [`the whole folder ${options.realDir} was removed`];
      } else {
        changes = diffFingerprints(before!, after);
      }
      if (changes.length === 0) {
        return;
      }
      const last = readIfThere(options.lastTestFile) || '(no test reported itself)';
      const started = readIfThere(options.startedFilesFile).split('\n').filter((line) => line !== '');
      throw new Error(
        `THE TEST RUN CHANGED THE REAL CONFIGURATION FOLDER ${options.realDir}:\n` +
          changes.map((line) => `  ${line}`).join('\n') +
          `\nLast test that started: ${last}\n` +
          `Test files that started (${started.length}): ${started.slice(-10).join(', ') || '(none)'}\n` +
          'A test used the real folder instead of a temp one (see test-support/isolateEnv.ts). If you used the project CLI or app-core yourself while the tests ran, run them again.\n' +
          'If something was removed, restore it with: project cli register',
      );
    },
  };
}

// --- vitest globalSetup ---------------------------------------------------------------------------------------------------------------

/** Where the real folder is, for the setup files of the workers (they run with a redirected environment and cannot work it out). */
export const REAL_DIR_VARIABLE = 'PROJECT_TEST_REAL_CONFIG_DIR';
export const LAST_TEST_VARIABLE = 'PROJECT_TEST_LAST_TEST_FILE';
export const STARTED_FILES_VARIABLE = 'PROJECT_TEST_STARTED_FILES_FILE';
/** JSON of the REAL values (before the redirection of the workers) of the variables the isolation redirects, for the few tests that must look at the real machine read-only. */
export const REAL_ENV_VARIABLE = 'PROJECT_TEST_REAL_ENV';
const REDIRECTED = ['XDG_CONFIG_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'APP_CORE_CONFIG_DIR', 'APP_CORE_PORT'];

let active: Guard | undefined;

export function setup(): void {
  const realDir = realConfigDir();
  const markers = mkdtempSync(join(tmpdir(), 'project-test-guard-'));
  const lastTestFile = join(markers, 'last-test.txt');
  const startedFilesFile = join(markers, 'started-files.txt');
  writeFileSync(lastTestFile, '');
  appendFileSync(startedFilesFile, '');
  // Inherited by the workers, which are started after this function returns.
  process.env[REAL_DIR_VARIABLE] = realDir;
  process.env[REAL_ENV_VARIABLE] = JSON.stringify(Object.fromEntries(REDIRECTED.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]])));
  process.env[LAST_TEST_VARIABLE] = lastTestFile;
  process.env[STARTED_FILES_VARIABLE] = startedFilesFile;
  active = createGuard({ realDir, lastTestFile, startedFilesFile });
  active.start();
}

export function teardown(): void {
  try {
    active?.finish();
  } catch (error) {
    // vitest reports an error thrown by a teardown ("error during close") but exits 0: the run must FAIL, loudly, with the message on stderr.
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    process.exitCode = 1;
    throw error;
  }
}
