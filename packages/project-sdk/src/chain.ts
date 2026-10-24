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
