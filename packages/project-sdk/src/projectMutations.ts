import { InvalidLabelError } from './errors.js';
import { generateId } from './ids.js';
import { assertLabelsFree, normalizeLabel } from './labels.js';
import { assertPathFree } from './pathOwnership.js';
import { assertDirectory, pathKey } from './paths.js';
import { MAX_PROJECT_LABELS, assertLabelCount, normalizeLabelSet } from './projectLabels.js';
import { resolveReference } from './references.js';
import { loadDeleted } from './registryIo.js';
import type { Project } from './types.js';
import { type MutationOptions, updateRegistry } from './update.js';
import { describeProject } from './projects.js';

export interface AddProjectInput {
  name: string;
  aliases?: string[];
  /** First path of the project, registered as its main path. Must exist and be a directory. */
  path?: string;
  /** Reference (name, alias or id) of the parent project. */
  parent?: string;
  git?: string;
  /** Labels of the project (see parseLabel), normalized and deduplicated. */
  labels?: string[];
}

/** Registers a project. A project without path is "virtual". */
export function addProject(registryDir: string, input: AddProjectInput, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const name = normalizeLabel(input.name, 'name');
      const aliases = (input.aliases ?? []).map((alias) => normalizeLabel(alias, 'alias'));
      assertLabelsFree(registry, [{ label: name, kind: 'name' }, ...aliases.map((label) => ({ label, kind: 'alias' as const }))]);
      const parent = input.parent === undefined ? undefined : resolveReference(registry, input.parent);
      const labels = normalizeLabelSet(input.labels ?? []);
      assertLabelCount(labels, labels[MAX_PROJECT_LABELS] ?? '');
      let path: string | undefined;
      if (input.path !== undefined) {
        path = assertPathFree(registry, input.path);
        assertDirectory(path);
      }
      const takenIds = new Set([...registry.projects.map((p) => p.id), ...loadDeleted(registryDir).projects.map((p) => p.id)]);
      const id = generateId((candidate) => takenIds.has(candidate));
      const project: Project = {
        id,
        name,
        aliases,
        ...(parent === undefined ? {} : { parent: parent.id }),
        paths: path === undefined ? [] : [{ path, main: true }],
        labels,
        ...(input.git === undefined ? {} : { git: input.git }),
        createdAt: new Date().toISOString(),
      };
      registry.projects.push(project);
      return { result: project, pathsToCheck: path === undefined ? [] : [pathKey(path)] };
    },
    options,
  );
}

/** Changes the name; id, aliases and paths are kept. */
export function renameProject(registryDir: string, ref: string, newName: string, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const name = normalizeLabel(newName, 'name');
      assertLabelsFree(registry, [{ label: name, kind: 'name' }]);
      project.name = name;
      return { result: project };
    },
    options,
  );
}

export function addAlias(registryDir: string, ref: string, alias: string, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const label = normalizeLabel(alias, 'alias');
      assertLabelsFree(registry, [{ label, kind: 'alias' }]);
      project.aliases.push(label);
      return { result: project };
    },
    options,
  );
}

export function removeAlias(registryDir: string, ref: string, alias: string, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const label = alias.trim().toLowerCase();
      if (!project.aliases.includes(label)) {
        const known = project.aliases.length > 0 ? project.aliases.join(', ') : 'none';
        throw new InvalidLabelError(`project ${describeProject(project)} has no alias '${alias}' (its aliases: ${known}); nothing was changed`);
      }
      project.aliases = project.aliases.filter((a) => a !== label);
      return { result: project };
    },
    options,
  );
}

/** Sets the parent (inheritance link) or clears it with null. Cycles are refused by the write validation. */
export function setParent(registryDir: string, ref: string, parentRef: string | null, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      if (parentRef === null) {
        delete project.parent;
      } else {
        project.parent = resolveReference(registry, parentRef).id;
      }
      return { result: project };
    },
    options,
  );
}

/** Sets the optional git field (one free string, not validated) or clears it with null. */
export function setGit(registryDir: string, ref: string, value: string | null, options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      if (value === null) {
        delete project.git;
      } else {
        project.git = value;
      }
      return { result: project };
    },
    options,
  );
}
