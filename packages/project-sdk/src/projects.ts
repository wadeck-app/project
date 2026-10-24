import type { ProjectRef } from './errors.js';
import type { Project } from './types.js';

/** `shop (3fa9c1d2)`: how every message and log line names a project. */
export function describeProject(project: Pick<Project, 'name' | 'id'>): string {
  return `${project.name} (${project.id})`;
}

/** The main path of a project, undefined for a virtual project. */
export function mainPath(project: Project): string | undefined {
  return project.paths.find((entry) => entry.main)?.path;
}

/** The identity of a project as carried by error data. */
export function projectRef(project: Pick<Project, 'name' | 'id'>): ProjectRef {
  return { id: project.id, name: project.name };
}

/** A virtual project has no path: it only carries shared configuration and data. */
export function isVirtual(project: Pick<Project, 'paths'>): boolean {
  return project.paths.length === 0;
}
