import { type Project, normalizePath, projectDir, toNativePath } from '@wadeck-app/project-sdk';

/** The folder holding the per-tool config and data of a project, in the normalized form used for every path shown. */
export function projectFolder(registryDir: string, project: Pick<Project, 'id'>): string {
  return normalizePath(projectDir(registryDir, project.id));
}

/** One line per registered path, in the native form (`C:workshop (main)`), or a single `none (virtual)` line. */
export function pathLines(project: Project, indent: string): string[] {
  return project.paths.length === 0 ? [`${indent}none (virtual)`] : project.paths.map((p) => `${indent}${toNativePath(p.path)}${p.main ? ' (main)' : ''}`);
}

/** Left-aligned columns separated by two spaces; the last column is not padded. */
export function table(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!))).join('  '));
}

/** A project as `--json` shows it: `labels` is always a list, also for a project of a registry written before labels existed. */
export function forJson<T extends Project>(project: T): T & { labels: string[] } {
  return { ...project, labels: project.labels ?? [] };
}

/** `state::production, sandbox`, or `none`. */
export function labelList(project: Pick<Project, 'labels'>): string {
  return (project.labels ?? []).join(', ') || 'none';
}
