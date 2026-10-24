import { basename } from 'node:path';
import { InvalidLabelError, LabelTakenError } from './errors.js';
import { isIdLike } from './ids.js';
import { normalizePath } from './paths.js';
import type { Project, Registry } from './types.js';
import { describeProject, projectRef } from './projects.js';

export type LabelKind = 'name' | 'alias';

const LABEL_RULE = '^[a-z][a-z0-9._-]*$';
const LABEL_PATTERN = /^[a-z][a-z0-9._-]*$/;
const MAX_LABEL_LENGTH = 64;

/** Validates a name or alias and returns it trimmed and lowercased. */
export function normalizeLabel(input: string, kind: LabelKind): string {
  const label = input.trim().toLowerCase();
  if (label.length > MAX_LABEL_LENGTH) {
    throw new InvalidLabelError(`${kind} '${input}' is too long: at most ${MAX_LABEL_LENGTH} characters (got ${label.length}); choose a shorter ${kind}`);
  }
  if (!LABEL_PATTERN.test(label)) {
    throw new InvalidLabelError(
      `${kind} '${input}' is invalid: it must match ${LABEL_RULE} (lowercase letters, digits, '.', '_' and '-', starting with a letter); choose another ${kind}`,
    );
  }
  if (isIdLike(label)) {
    throw new InvalidLabelError(`${kind} '${input}' looks like a project id (8 hex characters) and would be ambiguous; choose another ${kind}`);
  }
  return label;
}

/** The project whose name, alias or id equals the label (case-insensitive), if any. */
export function findLabelOwner(registry: Registry, label: string): Project | undefined {
  const wanted = label.toLowerCase();
  return registry.projects.find((p) => p.id === wanted || p.name === wanted || p.aliases.includes(wanted));
}

/**
 * Refuses labels already used as name, alias or id by any project (own entries included), or repeated inside the request.
 * Labels must already be normalized.
 */
export function assertLabelsFree(registry: Registry, requested: { label: string; kind: LabelKind }[]): void {
  const seen = new Set<string>();
  for (const { label, kind } of requested) {
    const owner = findLabelOwner(registry, label);
    if (owner !== undefined) {
      throw new LabelTakenError(
        `${kind} '${label}' is already used by project ${describeProject(owner)}; names, aliases and ids are unique across projects, choose another ${kind}`,
        { kind, label, owner: projectRef(owner) },
      );
    }
    if (seen.has(label)) {
      throw new LabelTakenError(`${kind} '${label}' is requested twice for the same project; names and aliases must all be different`, { kind, label });
    }
    seen.add(label);
  }
}

/** The name a folder suggests: its base name, lowercased. Fails with the reason when that is not a valid name, so the caller can ask for an explicit one. */
export function deriveName(path: string): string {
  const folder = basename(normalizePath(path));
  try {
    return normalizeLabel(folder, 'name');
  } catch (error) {
    if (error instanceof InvalidLabelError) {
      throw new InvalidLabelError(`cannot derive a project name from the folder '${folder}' (${error.message}); pass an explicit name`);
    }
    throw error;
  }
}
