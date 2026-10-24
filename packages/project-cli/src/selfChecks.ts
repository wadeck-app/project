import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAlias, addProject, loadRegistry, resolveReference } from '@wadeck-app/project-sdk';
import type { SelfCheckResult } from '@wadeck-app/shared-cli';
import { currentVersion } from './version.js';

type Check = () => Promise<SelfCheckResult>;

/** Runs `body`; any error becomes a failed result carrying the reason, never an escaped exception. */
function check(name: string, body: () => void | Promise<void>): Check {
  return async () => {
    try {
      await body();
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Runs `body` against an empty registry in a temporary folder: a self-check never touches the real registry. */
async function inTempRegistry(body: (registryDir: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'project-self-check-'));
  try {
    await body(join(root, 'registry'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The checks `project cli self-check` runs; the updater runs them on the freshly installed version before keeping it. */
export function selfChecks(): Check[] {
  return [
    check('Version', () => {
      if (currentVersion() === '') {
        throw new Error('the version of the bundle is empty');
      }
    }),
    check('Registry (temp)', () =>
      inTempRegistry(async (registryDir) => {
        await addProject(registryDir, { name: 'self-check' });
        const projects = loadRegistry(registryDir).projects;
        if (projects.length !== 1 || projects[0]!.name !== 'self-check') {
          throw new Error(`expected the project that was just added, found ${JSON.stringify(projects.map((p) => p.name))}`);
        }
      }),
    ),
    check('Reference resolution (temp)', () =>
      inTempRegistry(async (registryDir) => {
        const added = await addProject(registryDir, { name: 'self-check' });
        await addAlias(registryDir, 'self-check', 'sc');
        const resolved = resolveReference(loadRegistry(registryDir), 'SC');
        if (resolved.id !== added.id) {
          throw new Error(`the alias resolved to ${resolved.id} instead of ${added.id}`);
        }
      }),
    ),
  ];
}
