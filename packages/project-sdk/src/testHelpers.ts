import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePath } from './paths.js';
import type { Project, Registry } from './types.js';

/** Test-only factory (excluded from the build): a valid project with distinct id and name derived from `n`. */
export function makeProject(n: number, overrides: Partial<Project> = {}): Project {
  const hex = n.toString(16).padStart(8, '0');
  return { id: hex, name: `p${n}`, aliases: [], paths: [], createdAt: '2026-10-24T00:00:00.000Z', ...overrides };
}

export function makeRegistry(...projects: Project[]): Registry {
  return { schemaVersion: 1, projects };
}

export interface Workspace {
  registryDir: string;
  /** Creates (if needed) a work folder and returns its normalized path. */
  dir: (name: string) => string;
  cleanup: () => void;
}

/** Real temporary registry directory and work folders; call cleanup() in afterEach. */
export function makeWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'project-sdk-ws-'));
  return {
    registryDir: join(root, 'registry'),
    dir: (name) => {
      const path = join(root, 'work', name);
      mkdirSync(path, { recursive: true });
      return normalizePath(path);
    },
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  };
}

// Lines that npm and node print on their own, whatever the code under test does (`npm warn ...` from the npmrc of setup-node, deprecation
// and experimental warnings, the debugger). Same rule as significantStderr of project-cli (the packages do not share test helpers).
const NOISE = [/^npm warn(\s|$)/, /^\(node:\d+\) /, /^\(Use `node --trace-/, /^Debugger attached/, /^Waiting for the debugger/, /^Debugger listening/];

/** The stderr of a child process without the noise of npm and node: real errors are kept as they are. */
export function significantStderr(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !NOISE.some((pattern) => pattern.test(line)))
    .join('\n')
    .replace(/\s+$/, '');
}
