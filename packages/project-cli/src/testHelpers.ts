import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePath } from '@wadeck-app/project-sdk';
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
