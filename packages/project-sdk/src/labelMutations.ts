import { ProjectLabelNotFoundError } from './errors.js';
import { MAX_PROJECT_LABELS, assertLabelCount, normalizeLabelSet } from './projectLabels.js';
import { describeProject, projectRef } from './projects.js';
import { resolveReference } from './references.js';
import type { Project } from './types.js';
import { type MutationOptions, updateRegistry } from './update.js';

/**
 * Adds labels to a project, as a set: a label it already has is left as it is (the project is still returned).
 * All the labels are checked before anything is written. Labels are not inherited through the parent chain.
 */
export function addLabels(registryDir: string, ref: string, labels: readonly string[], options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const current = project.labels ?? [];
      const added = normalizeLabelSet(labels).filter((label) => !current.includes(label));
      const result = [...current, ...added];
      // The first label that does not fit is the one named in the error.
      assertLabelCount(result, result[MAX_PROJECT_LABELS] ?? '');
      project.labels = result;
      return { result: project };
    },
    options,
  );
}

/** Removes labels from a project. A label it does not have is an error naming it (a typo must be loud); nothing is removed then. */
export function removeLabels(registryDir: string, ref: string, labels: readonly string[], options: MutationOptions = {}): Promise<Project> {
  return updateRegistry(
    registryDir,
    (registry) => {
      const project = resolveReference(registry, ref);
      const current = project.labels ?? [];
      const unwanted = normalizeLabelSet(labels);
      for (const label of unwanted) {
        if (!current.includes(label)) {
          throw new ProjectLabelNotFoundError(
            `project ${describeProject(project)} has no label '${label}' (its labels: ${current.length > 0 ? current.join(', ') : 'none'}); nothing was changed`,
            { label, project: projectRef(project) },
          );
        }
      }
      project.labels = current.filter((label) => !unwanted.includes(label));
      return { result: project };
    },
    options,
  );
}
