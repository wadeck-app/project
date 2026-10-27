import { getDescendants } from './chain.js';
import { AmbiguousReferenceError, InvalidPathError, LabelTakenError, ProjectNotFoundError, RestoreConflictError } from './errors.js';
import { assertLabelsFree } from './labels.js';
import { findPathOwner } from './pathOwnership.js';
import { assertDirectory, pathKey, toNativePath } from './paths.js';
import { describeProject, projectRef } from './projects.js';
import { suggest } from './references.js';
import { loadDeleted } from './registryIo.js';
import type { DeletedProject, Project, Registry } from './types.js';
import { type MutationOptions, updateRegistry } from './update.js';

function notFound(candidates: DeletedProject[], original: string, wanted: string): ProjectNotFoundError {
  const found = suggest({ schemaVersion: 1, projects: candidates }, wanted);
  const shown = found.map((s) => (s.isName ? describeProject(s.project) : `${s.text} (alias of ${describeProject(s.project)})`));
  const hint = shown.length > 0 ? `; did you mean: ${shown.join(', ')}? (suggestions only, nothing was selected)` : '';
  const nothing = candidates.length === 0 ? '; nothing was deleted' : '';
  return new ProjectNotFoundError(`no deleted project matches '${original}'${hint}${nothing}; see 'project list --deleted'`, {
    ref: original,
    suggestions: found.map(({ text, project }) => ({ text, project })),
  });
}

/** The deleted entry designated by an exact id, or by an exact name or alias (case-insensitive). An id that is live is never a candidate. */
function findDeleted(registry: Registry, candidates: DeletedProject[], ref: string): DeletedProject {
  const wanted = ref.trim().toLowerCase();
  const byId = candidates.find((p) => p.id === wanted);
  if (byId !== undefined) {
    return byId;
  }
  const live = registry.projects.find((p) => p.id === wanted);
  if (live !== undefined) {
    throw new ProjectNotFoundError(`no deleted project matches '${ref}': the project ${describeProject(live)} is already live, there is nothing to restore`, { ref, suggestions: [] });
  }
  const byName = candidates.filter((p) => p.name === wanted || p.aliases.includes(wanted));
  if (byName.length === 1) {
    return byName[0]!;
  }
  if (byName.length > 1) {
    const listed = byName.map((p) => `${p.id} (deleted ${p.deletedAt})`).join(', ');
    throw new AmbiguousReferenceError(`'${ref}' matches ${byName.length} deleted projects: ${listed}; restore by id`, { ref, candidates: byName.map(projectRef) });
  }
  throw notFound(candidates, ref, wanted);
}

function conflict(project: Project, reason: string, conflictsWith?: Project): RestoreConflictError {
  return new RestoreConflictError(`cannot restore ${describeProject(project)}: ${reason}`, {
    project: projectRef(project),
    ...(conflictsWith === undefined ? {} : { conflictsWith: projectRef(conflictsWith) }),
  });
}

/** Puts one deleted entry back into the registry after the checks whose failure the user can act on; the full validation follows on write. */
function restoreOne(registry: Registry, all: DeletedProject[], entry: DeletedProject): Project {
  const { deletedAt: _deletedAt, ...stored } = entry;
  const project: Project = structuredClone(stored);
  if (project.parent !== undefined && !registry.projects.some((p) => p.id === project.parent)) {
    const parent = all.find((p) => p.id === project.parent);
    const named = parent === undefined ? `'${project.parent}' (not in the registry at all)` : describeProject(parent);
    throw conflict(project, `its parent ${named} is not a live project; restore the parent first (or restore both with the recursive option)`, parent);
  }
  try {
    assertLabelsFree(registry, [
      { label: project.name, kind: 'name' },
      ...project.aliases.map((label) => ({ label, kind: 'alias' as const })),
    ]);
  } catch (error) {
    if (error instanceof LabelTakenError && error.owner !== undefined) {
      const owner = registry.projects.find((p) => p.id === error.owner!.id);
      throw conflict(project, `its ${error.kind} '${error.label}' is used by the live project ${describeProject(error.owner)}; rename or remove that project, then restore again`, owner);
    }
    throw error;
  }
  for (const entryPath of project.paths) {
    const owner = findPathOwner(registry, entryPath.path);
    if (owner !== undefined) {
      throw conflict(project, `its path ${toNativePath(entryPath.path)} is registered by the live project ${describeProject(owner)}; remove the path from that project first, then restore again`, owner);
    }
    try {
      assertDirectory(entryPath.path);
    } catch (error) {
      if (error instanceof InvalidPathError) {
        throw conflict(project, `${error.message.replace(/;.*$/s, '')}; recreate the folder at that path, then restore again`);
      }
      throw error;
    }
  }
  registry.projects.push(project);
  return project;
}

/**
 * Brings a soft-deleted project back (its folder projects/<id>/, with the data, was never deleted). `ref` is an exact id, or an exact name or
 * alias among the deleted projects. The parent must be live; with `recursive` the deleted descendants come back too, parents before children,
 * all of them or none. Any collision with a live project (name, alias, path), a path that is gone, or a missing parent is an error naming what is
 * in the way, and nothing changes. registry.json is written first, then the entry leaves deleted_projects.json: after a crash an id may be in both
 * files, it is then live and the stale entry is dropped by the next restore or removal.
 */
export function restoreProject(registryDir: string, ref: string, options: MutationOptions & { recursive?: boolean } = {}): Promise<Project[]> {
  const { recursive = false, ...mutation } = options;
  return updateRegistry(
    registryDir,
    (registry) => {
      const all = loadDeleted(registryDir).projects;
      const liveIds = new Set(registry.projects.map((p) => p.id));
      const candidates = all.filter((p) => !liveIds.has(p.id));
      const root = findDeleted(registry, candidates, ref);
      const subtree = recursive ? [root, ...getDescendants({ schemaVersion: 1, projects: candidates }, root)] : [root];
      const restored = subtree.map((entry) => restoreOne(registry, all, entry as DeletedProject));
      return {
        result: restored,
        pathsToCheck: restored.flatMap((p) => p.paths.map((entry) => pathKey(entry.path))),
        restored: restored.map((p) => p.id),
      };
    },
    mutation,
  );
}
