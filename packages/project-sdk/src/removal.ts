import { HasChildrenError } from './errors.js';
import { resolveReference } from './references.js';
import type { DeletedProject, Project, Registry } from './types.js';
import { type MutationOptions, updateRegistry } from './update.js';
import { describeProject, projectRef } from './projects.js';

/** The project followed by all its descendants, parents before children. */
function collectSubtree(registry: Registry, root: Project): Project[] {
  const subtree = [root];
  for (const current of subtree) {
    subtree.push(...registry.projects.filter((p) => p.parent === current.id));
  }
  return subtree;
}

/**
 * Soft delete: the entry moves to deleted_projects.json; the folder projects/<id>/ is never touched.
 * A project with children is refused unless `recursive` (then all descendants are deleted with it).
 * Returns the deleted entries, the requested project first.
 */
export function removeProject(registryDir: string, ref: string, flags: { recursive?: boolean } = {}, options: MutationOptions = {}): Promise<DeletedProject[]> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const subtree = collectSubtree(registry, project);
      if (subtree.length > 1 && flags.recursive !== true) {
        const children = subtree.slice(1).map(describeProject);
        throw new HasChildrenError(
          `project ${describeProject(project)} has ${children.length} descendant(s): ${children.join(', ')}; ` +
            'remove them first, or remove the project together with all its descendants',
          { project: projectRef(project), children: subtree.slice(1).map(projectRef) },
        );
      }
      const deletedAt = new Date().toISOString();
      const removed = subtree.map((p) => ({ ...p, deletedAt }));
      registry.projects = registry.projects.filter((p) => !subtree.includes(p));
      return { result: removed, removed };
    },
    options,
  );
}
