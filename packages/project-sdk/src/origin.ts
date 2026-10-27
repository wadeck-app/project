import { toNativePath } from './paths.js';
import type { Scope } from './resolution.js';

/**
 * Where a cross-project action comes from, as task, flow and queue record it in history, event payloads and hook context.
 * Plain data (JSON-safe); every field but `tool` and `at` exists only when known. Never holds an environment value or a credential.
 */
export interface Origin {
  tool: string;
  /** ISO 8601 time of the action. */
  at: string;
  projectId?: string;
  projectName?: string;
  /** The working directory of the project in the stored (forward-slash) form. */
  cwd?: string;
}

/** The origin of an action run by `tool`; the project fields come from the scope when there is one ("when available"). */
export function buildOrigin(tool: string, scope?: Scope, now: Date = new Date()): Origin {
  return {
    tool,
    at: now.toISOString(),
    ...(scope === undefined ? {} : { projectId: scope.project.id, projectName: scope.project.name }),
    ...(scope?.path === undefined ? {} : { cwd: scope.path }),
  };
}

/** One human line: `task from shop (3fa9c1d2) at C:\work\shop`, or `task from outside any project`. */
export function formatOrigin(origin: Origin): string {
  if (origin.projectId === undefined) {
    return `${origin.tool} from outside any project`;
  }
  const where = origin.cwd === undefined ? '' : ` at ${toNativePath(origin.cwd)}`;
  return `${origin.tool} from ${origin.projectName} (${origin.projectId})${where}`;
}
