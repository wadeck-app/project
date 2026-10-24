import { InvalidPathError, MainPathError } from './errors.js';
import { assertPathFree } from './pathOwnership.js';
import { assertDirectory, normalizePath, pathKey } from './paths.js';
import { resolveReference } from './references.js';
import type { Project, ProjectPath } from './types.js';
import { type MutationOptions, updateRegistry } from './update.js';
import { describeProject } from './projects.js';

function ownPath(project: Project, path: string): ProjectPath {
  const key = pathKey(path);
  const entry = project.paths.find((p) => pathKey(p.path) === key);
  if (entry === undefined) {
    const known = project.paths.length > 0 ? project.paths.map((p) => p.path).join(', ') : 'none';
    throw new InvalidPathError(
      `project ${describeProject(project)} does not have path ${normalizePath(path)} (registered paths: ${known}); nothing was changed`,
      normalizePath(path),
    );
  }
  return entry;
}

function makeMain(project: Project, entry: ProjectPath): void {
  project.paths.forEach((p) => {
    p.main = p === entry;
  });
}

/** Registers a path. The first path of a project is always its main path; later ones are main only when asked. */
export function addPath(registryDir: string, ref: string, path: string, flags: { main?: boolean } = {}, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const normalized = assertPathFree(registry, path);
      assertDirectory(normalized);
      const entry: ProjectPath = { path: normalized, main: false };
      const first = project.paths.length === 0;
      project.paths.push(entry);
      if (first || flags.main === true) {
        makeMain(project, entry);
      }
      return { result: project, pathsToCheck: [pathKey(normalized)] };
    },
    options,
  );
}

/** Unregisters a path. Removing the main path while other paths exist requires naming the new main one. */
export function removePath(registryDir: string, ref: string, path: string, flags: { newMain?: string } = {}, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const removed = ownPath(project, path);
      const remaining = project.paths.filter((p) => p !== removed);
      if (flags.newMain !== undefined) {
        const replacement = ownPath(project, flags.newMain);
        if (replacement === removed) {
          throw new InvalidPathError(`the new main path ${replacement.path} is the path being removed; name another path of project ${project.name}`, replacement.path);
        }
        project.paths = remaining;
        makeMain(project, replacement);
      } else if (removed.main && remaining.length > 0) {
        throw new MainPathError(
          `${removed.path} is the main path of project ${describeProject(project)} and other paths exist (${remaining.map((p) => p.path).join(', ')}); ` +
            'name a new main path, or set another main path first',
        );
      } else {
        project.paths = remaining;
      }
      return { result: project };
    },
    options,
  );
}

/** Replaces a path by another one, keeping the project id and the main flag (the folder was moved or renamed). */
export function movePath(registryDir: string, ref: string, fromPath: string, toPath: string, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const entry = ownPath(project, fromPath);
      const target = normalizePath(toPath);
      // A change of letter case of the project's own path is not a collision with itself.
      if (pathKey(target) !== pathKey(entry.path)) {
        assertPathFree(registry, target);
      }
      assertDirectory(target);
      entry.path = target;
      return { result: project, pathsToCheck: [pathKey(target)] };
    },
    options,
  );
}

export function setMain(registryDir: string, ref: string, path: string, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      makeMain(project, ownPath(project, path));
      return { result: project };
    },
    options,
  );
}
