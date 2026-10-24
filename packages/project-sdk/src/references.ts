import { AmbiguousReferenceError, ProjectNotFoundError, type ProjectRef } from './errors.js';
import type { Project, Registry } from './types.js';
import { describeProject, projectRef } from './projects.js';

const MIN_PREFIX_LENGTH = 4;
const MAX_SUGGESTIONS = 3;

/** Edit distance between two strings (insertions, deletions, substitutions). */
export function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length]!;
}


interface Suggestion {
  text: string;
  project: ProjectRef;
}

function suggest(registry: Registry, reference: string): (Suggestion & { isName: boolean })[] {
  const maxDistance = Math.max(2, Math.floor(reference.length / 3));
  const candidates = registry.projects
    .flatMap((project) => [project.name, ...project.aliases].map((text) => ({ text, project, distance: levenshtein(reference, text) })))
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((x, y) => x.distance - y.distance || x.text.localeCompare(y.text));
  return candidates.slice(0, MAX_SUGGESTIONS).map((c) => ({ text: c.text, project: projectRef(c.project), isName: c.text === c.project.name }));
}

function notFound(registry: Registry, original: string, reference: string): ProjectNotFoundError {
  const found = suggest(registry, reference);
  const shown = found.map((s) => (s.isName ? describeProject(s.project) : `${s.text} (alias of ${describeProject(s.project)})`));
  const hint = shown.length > 0 ? `; did you mean: ${shown.join(', ')}? (suggestions only, nothing was selected)` : '';
  return new ProjectNotFoundError(`no project matches '${original}'${hint}; see 'project list'`, {
    ref: original,
    suggestions: found.map(({ text, project }) => ({ text, project })),
  });
}

/**
 * Resolves a --project reference: exact name or alias, else exact id, else unique id prefix (min 4 chars). Case-insensitive.
 * Never guesses: a miss lists suggestions in the message only.
 */
export function resolveReference(registry: Registry, ref: string): Project {
  const reference = ref.trim().toLowerCase();
  if (reference === '') {
    throw new ProjectNotFoundError("the project reference is empty; pass a project name, alias or id, see 'project list'", { ref, suggestions: [] });
  }
  const byLabel = registry.projects.filter((p) => p.name === reference || p.aliases.includes(reference));
  const exact = byLabel.length > 0 ? byLabel : registry.projects.filter((p) => p.id === reference);
  const matches =
    exact.length > 0 || reference.length < MIN_PREFIX_LENGTH ? exact : registry.projects.filter((p) => p.id.startsWith(reference));
  if (matches.length === 0) {
    throw notFound(registry, ref.trim(), reference);
  }
  if (matches.length > 1) {
    throw new AmbiguousReferenceError(
      `'${ref.trim()}' matches ${matches.length} projects: ${matches.map(describeProject).join(', ')}; use a name, an alias or a longer prefix of the id`,
      { ref: ref.trim(), candidates: matches.map(projectRef) },
    );
  }
  return matches[0]!;
}
