import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getChain } from './chain.js';
import { InvalidIdError, InvalidToolError } from './errors.js';
import { isIdLike } from './ids.js';
import type { Project, Registry } from './types.js';

export type ToolDirKind = 'config' | 'data';

export interface ConfigLayer {
  project: Project;
  /** Config directory of that project for the tool; it may not exist. */
  dir: string;
}

const TOOL_PATTERN = /^[a-z][a-z0-9-]*$/;

/** `<registryDir>/projects/<id>`: the folder of one project, parent of every tool folder. Built from the immutable id only, never from a name. */
export function projectDir(registryDir: string, projectId: string): string {
  if (!isIdLike(projectId)) {
    throw new InvalidIdError(`'${projectId}' is not a project id (8 lowercase hex characters); resolve the project first and pass its id, never a name or a path`);
  }
  return join(registryDir, 'projects', projectId);
}

/**
 * `<projectDir>/<tool>/<kind>`. The directory is created (recursively) only when `ensure` is true.
 */
export function projectToolDir(registryDir: string, projectId: string, tool: string, kind: ToolDirKind, options: { ensure?: boolean } = {}): string {
  const base = projectDir(registryDir, projectId);
  if (!TOOL_PATTERN.test(tool)) {
    throw new InvalidToolError(`tool name '${tool}' is invalid: it must match ^[a-z][a-z0-9-]*$ (for example 'task', 'flow', 'queue')`);
  }
  if (kind !== 'config' && kind !== 'data') {
    throw new InvalidToolError(`directory kind '${String(kind)}' is invalid: expected 'config' or 'data'`);
  }
  const dir = join(base, tool, kind);
  if (options.ensure === true) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Config directories of the project and its ancestors, root first. Pure: the CLIs read and parse the files. */
export function getConfigLayers(registry: Registry, registryDir: string, project: Project, tool: string): ConfigLayer[] {
  return getChain(registry, project).map((p) => ({ project: p, dir: projectToolDir(registryDir, p.id, tool, 'config') }));
}
