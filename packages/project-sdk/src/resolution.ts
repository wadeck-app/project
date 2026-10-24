import { NoProjectInScopeError, VirtualProjectError } from './errors.js';
import { normalizePath } from './paths.js';
import { cwdKeys, containmentLength } from './realPath.js';
import { resolveReference } from './references.js';
import type { Project, ProjectPath, Registry } from './types.js';
import { describeProject, mainPath } from './projects.js';

const MAX_LISTED_PROJECTS = 10;

export interface PathMatch {
  project: Project;
  /** The registered path that contains the queried folder. */
  path: string;
  main: boolean;
}

export type ScopeSource = 'flag' | 'env' | 'cwd';

export interface ResolveScopeInput {
  /** Value of --project / -p. An empty string is an error, not "unset". */
  flag?: string;
  /** Name shown as the source of `flag` (default: '--project'); use it when the reference comes from elsewhere, e.g. a positional argument. */
  label?: string;
  /** Value of the per-CLI environment variable (a blank value counts as unset). */
  env?: string;
  /** Display name of that variable (for messages only). */
  envName?: string;
  cwd: string;
}

export interface Scope {
  project: Project;
  /** Working directory of the project: the registered path containing the cwd, else its main path, else undefined (virtual). */
  path?: string;
  /** What supplied `path`: the cwd lies inside it, or it is the project's main path. */
  pathVia?: 'cwd' | 'main';
  source: ScopeSource;
  /** Human name of the source: '--project', the env var name, or 'cwd'. */
  via: string;
}

/**
 * The project owning the deepest registered path that is the folder itself or one of its ancestors.
 * A path also matches through its real folder (links, junctions, 8.3 short names); the disk is read only for that, and a missing folder is matched by its normalized path.
 */
export function findProjectForPath(registry: Registry, cwd: string): PathMatch | undefined {
  const target = cwdKeys(cwd);
  let best: { match: PathMatch; length: number } | undefined;
  for (const project of registry.projects) {
    for (const entry of project.paths) {
      const length = containmentLength(entry.path, target);
      if (length !== undefined && (best === undefined || length > best.length)) {
        best = { match: { project, path: entry.path, main: entry.main }, length };
      }
    }
  }
  return best?.match;
}

function pathOf(project: Project, cwd: string): Pick<Scope, 'path' | 'pathVia'> {
  const target = cwdKeys(cwd);
  const containing = project.paths
    .map((entry) => ({ entry, length: containmentLength(entry.path, target) }))
    .filter((candidate): candidate is { entry: ProjectPath; length: number } => candidate.length !== undefined)
    .sort((a, b) => b.length - a.length)[0]?.entry;
  if (containing !== undefined) {
    return { path: containing.path, pathVia: 'cwd' };
  }
  const main = mainPath(project);
  return main === undefined ? {} : { path: main, pathVia: 'main' };
}

function noProject(registry: Registry, cwd: string): NoProjectInScopeError {
  const entries = registry.projects.map((p) => (p.aliases.length === 0 ? p.name : `${p.name} (alias ${p.aliases.join(', ')})`));
  const listed =
    entries.length === 0
      ? 'none'
      : entries.length > MAX_LISTED_PROJECTS
        ? `${entries.slice(0, MAX_LISTED_PROJECTS).join(', ')}, ... (${entries.length - MAX_LISTED_PROJECTS} more)`
        : entries.join(', ');
  return new NoProjectInScopeError(
    `no project in scope for ${cwd}. Registered: ${listed}`,
    {
      cwd,
      registered: registry.projects.map((p) => p.name),
      hint: `pass a project reference, or register this folder with: project add "${cwd}"`,
    },
  );
}

/** Which project a command targets: flag, then env, then the cwd. A reference that does not resolve is an error, never a fallback. */
export function resolveScope(registry: Registry, input: ResolveScopeInput): Scope {
  const cwd = normalizePath(input.cwd);
  const envValue = input.env !== undefined && input.env.trim() !== '' ? input.env : undefined;
  if (input.flag !== undefined) {
    const project = resolveReference(registry, input.flag);
    return { project, ...pathOf(project, cwd), source: 'flag', via: input.label ?? '--project' };
  }
  if (envValue !== undefined) {
    const project = resolveReference(registry, envValue);
    return { project, ...pathOf(project, cwd), source: 'env', via: input.envName ?? 'environment variable' };
  }
  const match = findProjectForPath(registry, cwd);
  if (match === undefined) {
    throw noProject(registry, cwd);
  }
  return { project: match.project, path: match.path, pathVia: 'cwd', source: 'cwd', via: 'cwd' };
}

/** One human line stating how the configuration resolved (log it at the start of every command). */
export function describeResolution(scope: Scope, context: { registryDir: string }): string {
  const path = scope.path === undefined ? 'none (virtual project)' : `${scope.path} (${scope.pathVia})`;
  return `project: ${describeProject(scope.project)} via ${scope.via}, path ${path}; registry: ${context.registryDir}`;
}

/** The working directory of the scope, or VirtualProjectError when the project has no path. */
export function requirePath(scope: Scope): string {
  if (scope.path === undefined) {
    const name = scope.project.name;
    throw new VirtualProjectError(`project ${name} has no path, this command needs a working directory; add a path to the project first`);
  }
  return scope.path;
}
