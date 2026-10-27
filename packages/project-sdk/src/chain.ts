import { DanglingParentError, ParentCycleError } from './errors.js';
import type { Project, Registry } from './types.js';
import { describeProject } from './projects.js';

/** Projects from the root ancestor down to `project` (inclusive). Fails on a dangling parent or a cycle. */
export function getChain(registry: Registry, project: Project): Project[] {
  const chain: Project[] = [project];
  let current = project;
  while (current.parent !== undefined) {
    const parentId = current.parent;
    const parent = registry.projects.find((p) => p.id === parentId);
    if (parent === undefined) {
      throw new DanglingParentError(
        `project ${describeProject(current)} has parent '${parentId}' which is not in the registry; ` +
          `set an existing parent or clear it ('parent' of ${current.name} in registry.json), the parent may have been removed`,
      );
    }
    if (chain.includes(parent)) {
      const loop = [...chain.slice(chain.indexOf(parent)), parent].reverse().map((p) => p.name);
      throw new ParentCycleError(
        `parent cycle: ${loop.join(' -> ')}; clear or change the parent of one of these projects to break the loop`,
      );
    }
    chain.push(parent);
    current = parent;
  }
  return chain.reverse();
}

/** The direct children of a project (those whose parent it is), in registry order. */
export function getChildren(registry: Registry, project: Project): Project[] {
  return registry.projects.filter((p) => p.parent === project.id);
}

/**
 * All descendants of a project, breadth-first (children, then their children, ...), the project itself excluded.
 * Safe on a corrupted registry: a project is visited once, so a cycle ends the walk; a project whose parent does not exist is never reached.
 */
export function getDescendants(registry: Registry, project: Project): Project[] {
  const seen = new Set<string>([project.id]);
  const descendants: Project[] = [];
  const queue: Project[] = [project];
  for (const current of queue) {
    for (const child of getChildren(registry, current)) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        descendants.push(child);
        queue.push(child);
      }
    }
  }
  return descendants;
}

/** The ancestors of a project, its parent first and the root last, the project itself excluded. Fails like getChain on a dangling parent or a cycle. */
export function getAncestors(registry: Registry, project: Project): Project[] {
  return getChain(registry, project).slice(0, -1).reverse();
}
