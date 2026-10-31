import { type Project, type Registry, getDescendants, toNativePath } from '@wadeck-app/project-sdk';

export interface Option {
  value: string;
  label: string;
}

/** The projects a parent can be chosen among. */
export function parentChoices(projects: readonly Project[]): Option[] {
  return projects.map((p) => ({ value: p.id, label: p.name }));
}

export interface DetailOptions {
  aliases: Option[];
  labels: Option[];
  /** The paths of the project, to remove one or to move one. */
  paths: Option[];
  /** The paths that are not the main one: candidates to become it. */
  otherPaths: Option[];
  /** The projects that can become the parent: not the project itself and not one of its descendants (a cycle). */
  parents: Option[];
}

/** What the forms of the detail page let one choose among (select fields: the user picks, never types an exact value). */
export function detailOptions(registry: Registry, project: Project): DetailOptions {
  const excluded = new Set([project.id, ...getDescendants(registry, project).map((p) => p.id)]);
  const pathOption = (path: string): Option => ({ value: path, label: toNativePath(path) });
  return {
    aliases: project.aliases.map((alias) => ({ value: alias, label: alias })),
    labels: (project.labels ?? []).map((label) => ({ value: label, label })),
    paths: project.paths.map((entry) => pathOption(entry.path)),
    otherPaths: project.paths.filter((entry) => !entry.main).map((entry) => pathOption(entry.path)),
    parents: parentChoices(registry.projects.filter((p) => !excluded.has(p.id))),
  };
}

export interface DetailForms {
  /** Only the id of the project: the forms whose fields are all chosen by the user. */
  empty: { ref: string };
  rename: { ref: string; name: string };
  git: { ref: string; git: string };
  parent: { ref: string; parent: string };
}

/** The initial data of the forms: the id (it fills the address of the action) and the current value. */
export function detailForms(project: Project): DetailForms {
  return {
    empty: { ref: project.id },
    rename: { ref: project.id, name: project.name },
    git: { ref: project.id, git: project.git ?? '' },
    parent: { ref: project.id, parent: project.parent ?? '' },
  };
}
