import { loadDeleted, loadRegistry } from './registryIo.js';
import type { Project } from './types.js';

/**
 * The project with this exact id (not a name, an alias or a prefix), also when it was soft-deleted: tools keep records keyed by project id,
 * and the id of a removed project must still say which project they belong to. The live registry is looked at first.
 * `project` never carries `deletedAt`; it is returned apart.
 */
export function findProjectIncludingDeleted(registryDir: string, id: string): { project: Project; deleted: boolean; deletedAt?: string } | undefined {
  const wanted = id.trim().toLowerCase();
  const live = loadRegistry(registryDir).projects.find((p) => p.id === wanted);
  if (live !== undefined) {
    return { project: live, deleted: false };
  }
  const entry = loadDeleted(registryDir).projects.find((p) => p.id === wanted);
  if (entry === undefined) {
    return undefined;
  }
  const { deletedAt, ...project } = entry;
  return { project, deleted: true, deletedAt };
}
