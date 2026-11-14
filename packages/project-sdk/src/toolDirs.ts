import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getChain } from './chain.js';
import { InvalidIdError, InvalidToolError, ProjectDirAmbiguousError } from './errors.js';
import { isIdLike } from './ids.js';
import { loadRegistry } from './registryIo.js';
import { slugify } from './slug.js';
import type { Project, Registry } from './types.js';

export type ToolDirKind = 'config' | 'data' | 'cache' | 'logs';

export interface ConfigLayer {
  project: Project;
  /** Config directory of that project for the tool; it may not exist. */
  dir: string;
}

const TOOL_DIR_KINDS: readonly ToolDirKind[] = ['config', 'data', 'cache', 'logs'];
const TOOL_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Names in `<registryDir>/projects/` (none when the folder does not exist yet). */
function projectsEntries(projectsDir: string): string[] {
  try {
    return readdirSync(projectsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** The one folder of a project: the existing entry equal to `<id>` or starting with `<id>-`, else the path to create (`<id>-<slug>`, or `<id>` without slug). */
export function resolveProjectDir(registryDir: string, projectId: string, known: Pick<Project, 'name' | 'slug'> | undefined): string {
  if (!isIdLike(projectId)) {
    throw new InvalidIdError(`'${projectId}' is not a project id (8 lowercase hex characters); resolve the project first and pass its id, never a name or a path`);
  }
  const projectsDir = join(registryDir, 'projects');
  const found = projectsEntries(projectsDir)
    .filter((entry) => entry === projectId || entry.startsWith(`${projectId}-`))
    .sort();
  if (found.length === 1) {
    return join(projectsDir, found[0]!);
  }
  if (found.length > 1) {
    const folders = found.map((entry) => join(projectsDir, entry));
    throw new ProjectDirAmbiguousError(
      `two folders hold the data of project ${projectId}: ${folders.map((f) => `'${f}'`).join(' and ')}; merge them by hand, keep one (the name ${projectId}-<slug> is the current layout), then retry`,
      { projectId, folders },
    );
  }
  const source = known ?? loadRegistry(registryDir).projects.find((p) => p.id === projectId);
  const slug = source === undefined ? '' : (source.slug ?? slugify(source.name));
  return join(projectsDir, slug === '' ? projectId : `${projectId}-${slug}`);
}

/**
 * Folder of one project, parent of every tool folder: `<registryDir>/projects/<id>-<slug>`. Resolved from the immutable id by reading the disk:
 * the entry of `projects/` equal to `<id>` (legacy layout) or starting with `<id>-`. Exactly one: returned. Two or more: ProjectDirAmbiguousError
 * (never a guess; a link named `<id>` next to the named folder counts as a second entry). None: the path to create, `<id>-<slug>` with the slug of the
 * project in registry.json (or slugify(name) when it has none), `<id>` alone when that slug is empty or when the id is not in the registry
 * (no name is known: the behavior before slugs existed). Nothing is created.
 */
export function projectDir(registryDir: string, projectId: string): string {
  return resolveProjectDir(registryDir, projectId, undefined);
}

/**
 * `<projectDir>/<tool>/<kind>` (projectDir resolves the folder on disk, so it can throw ProjectDirAmbiguousError). The directory is created (recursively) only when `ensure` is true.
 */
export function projectToolDir(registryDir: string, projectId: string, tool: string, kind: ToolDirKind, options: { ensure?: boolean } = {}): string {
  return toolDirIn(projectDir(registryDir, projectId), tool, kind, options);
}

function toolDirIn(base: string, tool: string, kind: ToolDirKind, options: { ensure?: boolean } = {}): string {
  if (!TOOL_PATTERN.test(tool)) {
    throw new InvalidToolError(`tool name '${tool}' is invalid: it must match ^[a-z][a-z0-9-]*$ (for example 'task', 'flow', 'queue')`);
  }
  if (!TOOL_DIR_KINDS.includes(kind)) {
    throw new InvalidToolError(`directory kind '${String(kind)}' is invalid: expected 'config', 'data', 'cache' or 'logs'`);
  }
  const dir = join(base, tool, kind);
  if (options.ensure === true) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Config directories of the project and its ancestors, root first. Reads the disk (the folder of each project is resolved, see projectDir; the slugs come from `registry`), but not the config files: the CLIs read and parse them. */
export function getConfigLayers(registry: Registry, registryDir: string, project: Project, tool: string): ConfigLayer[] {
  return getChain(registry, project).map((p) => ({ project: p, dir: toolDirIn(resolveProjectDir(registryDir, p.id, p), tool, 'config') }));
}
