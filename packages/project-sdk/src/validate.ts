import { getChain } from './chain.js';
import { InvalidPathError, RegistryInvalidError } from './errors.js';
import { isIdLike } from './ids.js';
import { type LabelKind, normalizeLabel } from './labels.js';
import { assertDirectory, normalizePath, pathKey } from './paths.js';
import type { Project, Registry } from './types.js';
import { describeProject } from './projects.js';
import { realPathKey } from './realPath.js';

export interface ValidateOptions {
  /** default false. true: every registered path must exist as a directory; an array: only the paths with these keys (see pathKey). */
  checkPaths?: boolean | readonly string[];
}

function describe(project: Project): string {
  return `project ${describeProject(project)}`;
}

function checkLabel(project: Project, kind: LabelKind, label: string): void {
  let normalized: string;
  try {
    normalized = normalizeLabel(label, kind);
  } catch (error) {
    throw new RegistryInvalidError(`${describe(project)}: ${(error as Error).message}; rename it with the project command`);
  }
  if (normalized !== label) {
    throw new RegistryInvalidError(`${describe(project)}: ${kind} '${label}' must be stored lowercase and trimmed ('${normalized}'); rename it with the project command`);
  }
}

function checkIdentity(project: Project): void {
  if (!isIdLike(project.id)) {
    throw new RegistryInvalidError(
      `${describe(project)} has id '${project.id}', which is not 8 lowercase hex characters; ids are generated and immutable, restore the entry from a backup`,
    );
  }
  checkLabel(project, 'name', project.name);
  project.aliases.forEach((alias) => checkLabel(project, 'alias', alias));
}

function checkLabelsUnique(projects: Project[]): void {
  const owners = new Map<string, Project>();
  for (const project of projects) {
    for (const label of [project.id, project.name, ...project.aliases]) {
      const owner = owners.get(label);
      if (owner !== undefined) {
        const where = owner === project ? `twice in ${describe(project)}` : `by ${describe(owner)} and by ${describe(project)}`;
        throw new RegistryInvalidError(`'${label}' is used ${where}; names, aliases and ids must be unique across projects (case-insensitive), rename or remove one of them`);
      }
      owners.set(label, project);
    }
  }
}

function checkMain(project: Project): void {
  if (project.paths.length === 0) {
    return;
  }
  const mains = project.paths.filter((p) => p.main).length;
  if (mains !== 1) {
    throw new RegistryInvalidError(`${describe(project)} must have exactly one main path when it has paths, but has ${mains}; choose the main path with the project command`);
  }
}

function checkExists(project: Project, path: string): void {
  try {
    assertDirectory(path);
  } catch (error) {
    throw new InvalidPathError(`${describe(project)}: ${(error as Error).message}; or move the path with the project command`, error instanceof InvalidPathError ? error.path : undefined);
  }
}

function checkPaths(projects: Project[], toCheck: boolean | readonly string[]): void {
  const owners = new Map<string, Project>();
  // Real folders already seen: only a path being checked is compared through links, so an old duplicate never blocks an unrelated write.
  const realOwners = new Map<string, { project: Project; path: string; checked: boolean }>();
  const compareReal = toCheck === true || (toCheck !== false && toCheck.length > 0);
  for (const project of projects) {
    checkMain(project);
    for (const entry of project.paths) {
      if (normalizePath(entry.path) !== entry.path) {
        throw new RegistryInvalidError(`path '${entry.path}' of ${describe(project)} is not normalized (expected '${normalizePath(entry.path)}'); fix the entry`);
      }
      const key = pathKey(entry.path);
      const owner = owners.get(key);
      if (owner !== undefined) {
        throw new RegistryInvalidError(
          `path '${entry.path}' is registered by ${describe(owner)} and by ${describe(project)}; a path belongs to exactly one project, remove it from one of them`,
        );
      }
      owners.set(key, project);
      const checked = toCheck === true || (toCheck !== false && toCheck.includes(key));
      if (checked) {
        checkExists(project, entry.path);
      }
      const real = compareReal ? realPathKey(entry.path) : undefined;
      if (real !== undefined) {
        const other = realOwners.get(real);
        if (other !== undefined && (checked || other.checked)) {
          throw new RegistryInvalidError(
            `paths '${other.path}' (${describe(other.project)}) and '${entry.path}' (${describe(project)}) are the same folder reached through a link, junction or short name; ` +
              'a path belongs to exactly one project, remove one of them',
          );
        }
        realOwners.set(real, { project, path: entry.path, checked });
      }
    }
  }
}

/** Full validation run before every write; throws an error naming the entry and the fix. Never run on read. */
export function validateRegistry(registry: Registry, options: ValidateOptions = {}): void {
  registry.projects.forEach(checkIdentity);
  checkLabelsUnique(registry.projects);
  checkPaths(registry.projects, options.checkPaths ?? false);
  for (const project of registry.projects) {
    getChain(registry, project);
  }
}
