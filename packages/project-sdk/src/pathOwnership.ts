import { PathOwnedError } from './errors.js';
import { normalizePath, pathKey } from './paths.js';
import { describeProject } from './projects.js';
import { realPathKey } from './realPath.js';
import type { Project, Registry } from './types.js';

/**
 * The live project that registered this folder: the same normalized path, or (when the folder exists)
 * a path that leads to the same real folder through a link, junction or short name.
 */
export function findPathOwner(registry: Registry, path: string): Project | undefined {
  const key = pathKey(path);
  const byKey = registry.projects.find((p) => p.paths.some((entry) => pathKey(entry.path) === key));
  if (byKey !== undefined) {
    return byKey;
  }
  const real = realPathKey(path);
  return real === undefined ? undefined : registry.projects.find((p) => p.paths.some((entry) => realPathKey(entry.path) === real));
}

/** Refuses a path already registered by any project (the message names the owner). Returns the normalized path. */
export function assertPathFree(registry: Registry, path: string): string {
  const normalized = normalizePath(path);
  const owner = findPathOwner(registry, normalized);
  if (owner !== undefined) {
    throw new PathOwnedError(
      `path ${normalized} is already registered by project ${describeProject(owner)}; a path belongs to exactly one project, ` +
        'use that project or remove the path from it first',
    );
  }
  return normalized;
}
