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
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
