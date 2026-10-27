import { InvalidQualifiedIdError } from './errors.js';
import { resolveReference } from './references.js';
import type { Project, Registry } from './types.js';

const SHAPE = "a project-qualified id is '<project>/<id>' (the project by id, name or alias; the id never contains '/')";

function invalid(input: string, reason: string): InvalidQualifiedIdError {
  return new InvalidQualifiedIdError(`'${input}' is not a valid id: ${reason}; ${SHAPE}`, { input, reason });
}

/** `<project>/<id>`: how a tool refers to an id (task, run, event) of another project. Both parts must be non-empty and free of '/'. */
export function formatQualifiedId(projectId: string, localId: string): string {
  if (projectId === '' || localId === '') {
    throw invalid(`${projectId}/${localId}`, 'the project and the id must both be given');
  }
  if (projectId.includes('/') || localId.includes('/')) {
    throw invalid(`${projectId}/${localId}`, "the project and the id must not contain '/'");
  }
  return `${projectId}/${localId}`;
}

/** Splits on the first '/'. Without '/', there is no project part. An empty part, or a second '/', is an error. */
export function parseQualifiedId(input: string): { project?: string; id: string } {
  if (input.trim() === '') {
    throw invalid(input, 'it is empty');
  }
  const slash = input.indexOf('/');
  if (slash === -1) {
    return { id: input };
  }
  const project = input.slice(0, slash);
  const id = input.slice(slash + 1);
  if (project === '') {
    throw invalid(input, 'the project part is empty');
  }
  if (id === '') {
    throw invalid(input, 'the id part is empty');
  }
  if (id.includes('/')) {
    throw invalid(input, "it has more than one '/': one separates the project from the id, and an id never contains '/'");
  }
  return { project, id };
}

/**
 * The project and the local id a qualified id designates. The project part is resolved like any reference (id, name or alias, errors included);
 * without project part the `fallback` project is used, and its absence is an error that shows how to write the id.
 */
export function resolveQualifiedId(registry: Registry, input: string, fallback?: Project): { project: Project; id: string } {
  const parsed = parseQualifiedId(input);
  if (parsed.project !== undefined) {
    return { project: resolveReference(registry, parsed.project), id: parsed.id };
  }
  if (fallback === undefined) {
    throw invalid(input, `'${input}' has no project part and no project is in scope; write <project>/<id>, for example shop/${input}`);
  }
  return { project: fallback, id: parsed.id };
}
