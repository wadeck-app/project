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
}

/**
 * The only write path: lock, load, change in place, full validation, then atomic writes
 * (deleted file first, so a crash never loses an entry).
 */
export function updateRegistry<T>(registryDir: string, change: (registry: Registry) => Change<T>, options: MutationOptions = {}): Promise<T> {
  return withRegistryLock(
    registryDir,
    (lock) => {
      const registry = loadRegistry(registryDir);
      const { result, pathsToCheck = [], removed = [] } = change(registry);
      validateRegistry(registry, { checkPaths: pathsToCheck });
      if (removed.length > 0) {
        const deleted = loadDeleted(registryDir);
        saveDeleted(registryDir, { ...deleted, projects: [...deleted.projects, ...removed] }, lock);
      }
      saveRegistry(registryDir, registry, lock);
      return result;
    },
    options.lock,
  );
}
