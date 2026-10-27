import { type LockOptions, withRegistryLock } from './lock.js';
import { loadDeleted, loadRegistry, saveDeleted, saveRegistry } from './registryIo.js';
import type { DeletedProject, Registry } from './types.js';
import { validateRegistry } from './validate.js';

export interface MutationOptions {
  /** Lock behavior while waiting for another writer (timeout, onWait callback, ...). */
  lock?: LockOptions;
}

export interface Change<T> {
  result: T;
  /** Keys (see pathKey) of the paths added or moved by this change: only these must exist on disk. */
  pathsToCheck?: string[];
  /** Projects soft-deleted by this change, appended to deleted_projects.json before registry.json is written. */
  removed?: DeletedProject[];
  /** Ids of the projects this change brought back into the registry: registry.json is written first, then they leave deleted_projects.json. */
  restored?: string[];
}

/**
 * The only write path: lock, load, change in place, full validation, then atomic writes
 * (a removal writes the deleted file first and a restoration the registry first, so a crash never loses a project: at worst an id is in both files,
 * it is then live and the stale deleted entry is dropped by the next removal or restoration).
 */
export function updateRegistry<T>(registryDir: string, change: (registry: Registry) => Change<T>, options: MutationOptions = {}): Promise<T> {
  return withRegistryLock(
    registryDir,
    (lock) => {
      const registry = loadRegistry(registryDir);
      const { result, pathsToCheck = [], removed = [], restored = [] } = change(registry);
      validateRegistry(registry, { checkPaths: pathsToCheck });
      const liveIds = new Set(registry.projects.map((p) => p.id));
      const withoutLive = (all: DeletedProject[]): DeletedProject[] => all.filter((p) => !liveIds.has(p.id));
      if (removed.length > 0) {
        const deleted = loadDeleted(registryDir);
        saveDeleted(registryDir, { ...deleted, projects: [...withoutLive(deleted.projects), ...removed] }, lock);
      }
      saveRegistry(registryDir, registry, lock);
      if (restored.length > 0) {
        const deleted = loadDeleted(registryDir);
        saveDeleted(registryDir, { ...deleted, projects: withoutLive(deleted.projects) }, lock);
      }
      return result;
    },
    options.lock,
  );
}
