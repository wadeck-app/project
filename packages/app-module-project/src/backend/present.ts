import {
  type DeletedProject,
  type Project,
  type Registry,
  ProjectError,
  getChain,
  getChildren,
  getDescendants,
  isVirtual,
  mainPath,
  normalizePath,
  projectDir,
  toNativePath,
} from '@wadeck-app/project-sdk';

/** Where the detail page of a project is (module id and page path are fixed by manifest.json). */
export function projectHref(id: string): string {
  return `/modules/project/p/${id}`;
}

export interface ProjectRow {
  id: string;
  name: string;
  aliases: string[];
  aliasesText: string;
  parentId?: string;
  parentName: string;
  labels: string[];
  labelsText: string;
  mainPath?: string;
  mainPathText: string;
  virtual: boolean;
  virtualText: string;
  href: string;
}

const textOf = (items: readonly string[], empty = '-'): string => (items.length === 0 ? empty : items.join(', '));

function parentNameOf(parent: string | undefined, known: readonly Project[]): string {
  if (parent === undefined) {
    return '-';
  }
  return known.find((p) => p.id === parent)?.name ?? `${parent} (missing)`;
}

/** One project as a table row: the data, and the same as text (a table cell shows text). The paths are in the form of the platform. */
export function projectRow(project: Project, registry: Registry): ProjectRow {
  const labels = project.labels ?? [];
  const main = mainPath(project);
  return {
    id: project.id,
    name: project.name,
    aliases: project.aliases,
    aliasesText: textOf(project.aliases),
    ...(project.parent === undefined ? {} : { parentId: project.parent }),
    parentName: parentNameOf(project.parent, registry.projects),
    labels,
    labelsText: textOf(labels),
    ...(main === undefined ? {} : { mainPath: main }),
    mainPathText: main === undefined ? '(virtual)' : toNativePath(main),
    virtual: isVirtual(project),
    virtualText: isVirtual(project) ? 'virtual' : '',
    href: projectHref(project.id),
  };
}

export interface DeletedRow extends Omit<ProjectRow, 'href'> {
  deletedAt: string;
  /** The parent was deleted too: restoring this project needs the parent first (or both at once). */
  hasDeletedParent: boolean;
}

/** A removed project as a row of the trash. `live` only names a parent that is still alive. */
export function deletedRow(entry: DeletedProject, deleted: readonly DeletedProject[], live: readonly Project[] = []): DeletedRow {
  const { href: _href, ...row } = projectRow(entry, { schemaVersion: 1, projects: [...deleted, ...live] });
  return { ...row, deletedAt: entry.deletedAt, hasDeletedParent: entry.parent !== undefined && deleted.some((p) => p.id === entry.parent) };
}

export interface TreeRow {
  id: string;
  name: string;
  depth: number;
  /** The name drawn with its depth (ASCII), for a table cell. */
  treeLabel: string;
  virtual: boolean;
  virtualText: string;
  aliasesText: string;
  labelsText: string;
  mainPathText: string;
  href: string;
}

function treeLabel(name: string, depth: number): string {
  return depth === 0 ? name : `${'  '}${'    '.repeat(depth - 1)}|-- ${name}`;
}

/**
 * The projects as a flat list in tree order (roots in registry order, each followed by its children, depth-first) with warnings.
 * A project whose parent is not in the registry is shown as a root; a parent cycle is cut where it is first met. Never loops, never throws:
 * the registry may have been edited by hand.
 */
export function treeRows(registry: Registry): { rows: TreeRow[]; warnings: string[] } {
  const rows: TreeRow[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();
  const ids = new Set(registry.projects.map((p) => p.id));

  const visit = (project: Project, depth: number): void => {
    if (visited.has(project.id)) {
      return;
    }
    visited.add(project.id);
    const row = projectRow(project, registry);
    rows.push({
      id: project.id,
      name: project.name,
      depth,
      treeLabel: treeLabel(project.name, depth),
      virtual: row.virtual,
      virtualText: row.virtualText,
      aliasesText: row.aliasesText,
      labelsText: row.labelsText,
      mainPathText: row.mainPathText,
      href: row.href,
    });
    getChildren(registry, project).forEach((child) => visit(child, depth + 1));
  };

  for (const project of registry.projects) {
    if (project.parent === undefined) {
      visit(project, 0);
    } else if (!ids.has(project.parent)) {
      warnings.push(`${project.name} (${project.id}) has the parent '${project.parent}', which is not in the registry: shown as a root`);
      visit(project, 0);
    }
  }
  // What is left is in a parent cycle (or below one): start from the first, in registry order, until everything is shown once.
  for (const project of registry.projects) {
    if (!visited.has(project.id)) {
      const members = cycleFrom(registry, project);
      warnings.push(`parent cycle between ${members.map((p) => `${p.name} (${p.id})`).join(', ')}: shown from ${project.name}`);
      visit(project, 0);
    }
  }
  return { rows, warnings };
}

/** The projects met by following the parents from `start` until one comes back. */
function cycleFrom(registry: Registry, start: Project): Project[] {
  const path: Project[] = [];
  let current: Project | undefined = start;
  while (current !== undefined && !path.includes(current)) {
    path.push(current);
    current = registry.projects.find((p) => p.id === current!.parent);
  }
  return current === undefined ? path : path.slice(path.indexOf(current));
}

export interface ProjectRef {
  id: string;
  name: string;
  href: string;
}

export interface Detail {
  id: string;
  name: string;
  aliases: string[];
  aliasesText: string;
  aliasRows: { alias: string }[];
  labels: string[];
  labelsText: string;
  labelRows: { label: string }[];
  git?: string;
  gitText: string;
  createdAt: string;
  virtual: boolean;
  virtualText: string;
  parent: ProjectRef | null;
  parentText: string;
  chain: ProjectRef[];
  chainText: string;
  hasChildren: boolean;
  children: ProjectRow[];
  descendantsCount: number;
  descendants: ProjectRow[];
  hasPaths: boolean;
  paths: { path: string; pathText: string; main: boolean; mainText: string }[];
  /** The folder of the project in the registry, stored form, then in the form of the platform. */
  folder: string;
  folderText: string;
  toolFoldersText: string;
  warnings: string[];
  /** The warnings as one text, for a badge. */
  warningsText: string;
}

const refOf = (project: Project): ProjectRef => ({ id: project.id, name: project.name, href: projectHref(project.id) });

/** Everything the detail page shows about one project. A corrupted parent link gives a chain of the project alone and a warning, never an error. */
export function detailOf(registryDir: string, registry: Registry, project: Project): Detail {
  const warnings: string[] = [];
  let chain: Project[] = [project];
  try {
    chain = getChain(registry, project);
  } catch (error) {
    if (!(error instanceof ProjectError)) {
      throw error;
    }
    warnings.push(error.message);
  }
  const parent = project.parent === undefined ? undefined : registry.projects.find((p) => p.id === project.parent);
  const descendants = getDescendants(registry, project);
  const labels = project.labels ?? [];
  const folder = normalizePath(projectDir(registryDir, project.id));
  return {
    id: project.id,
    name: project.name,
    aliases: project.aliases,
    aliasesText: textOf(project.aliases, 'none'),
    aliasRows: project.aliases.map((alias) => ({ alias })),
    labels,
    labelsText: textOf(labels, 'none'),
    labelRows: labels.map((label) => ({ label })),
    ...(project.git === undefined ? {} : { git: project.git }),
    gitText: project.git ?? 'none',
    createdAt: project.createdAt,
    virtual: isVirtual(project),
    virtualText: isVirtual(project) ? 'virtual' : '',
    parent: parent === undefined ? null : refOf(parent),
    parentText: parent === undefined ? 'none' : parent.name,
    chain: chain.map(refOf),
    chainText: chain.map((p) => p.name).join(' > '),
    hasChildren: getChildren(registry, project).length > 0,
    children: getChildren(registry, project).map((p) => projectRow(p, registry)),
    descendantsCount: descendants.length,
    descendants: descendants.map((p) => projectRow(p, registry)),
    hasPaths: project.paths.length > 0,
    paths: project.paths.map((entry) => ({ path: entry.path, pathText: toNativePath(entry.path), main: entry.main, mainText: entry.main ? 'main' : '' })),
    folder,
    folderText: toNativePath(folder),
    toolFoldersText: `${toNativePath(folder)} (one folder per tool, each with config, data, cache and logs)`,
    warnings,
    warningsText: warnings.join(' '),
  };
}
