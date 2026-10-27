import { type DeletedProject, type Project, filterProjects, loadDeleted, loadRegistry, mainPath, toNativePath } from '@wadeck-app/project-sdk';
import type { CommandOutput, PlainCommand } from '../command.js';
import { forJson, table } from '../format.js';

const HEADER = ['ID', 'NAME', 'ALIASES', 'PARENT', 'LABELS', 'MAIN PATH'];

function rowOf(p: Project, parentName: (parent: string | undefined) => string): string[] {
  const main = mainPath(p);
  return [p.id, p.name, p.aliases.join(',') || '-', parentName(p.parent), (p.labels ?? []).join(',') || '-', main === undefined ? '(virtual)' : toNativePath(main)];
}

/** The deleted projects, with the date of their deletion (the data of a project is kept, `project restore` brings it back). */
function listDeleted(registryDir: string, selectors: string[]): CommandOutput {
  const { projects: all } = loadDeleted(registryDir);
  if (all.length === 0) {
    return { json: [], lines: ['no deleted project'] };
  }
  const projects = filterProjects({ schemaVersion: 1, projects: all }, selectors) as DeletedProject[];
  if (projects.length === 0) {
    return { json: [], lines: [`no deleted project has all the labels: ${selectors.join(', ')}`] };
  }
  const parentName = (parent: string | undefined): string => (parent === undefined ? '-' : (all.find((p) => p.id === parent)?.name ?? `${parent} (missing)`));
  return {
    json: projects.map(forJson),
    lines: table([[...HEADER, 'DELETED'], ...projects.map((p) => [...rowOf(p, parentName), p.deletedAt])]),
  };
}

export const listCommand: PlainCommand = {
  name: 'list',
  summary: 'List the registered projects',
  target: 'none',
  args: [],
  options: {
    label: {
      type: 'list',
      valueName: 'selector',
      description:
        "Only the projects that have this label, repeat to require several (AND). Selectors: key::value, key::* (any label with the key), *::value (any label with the value), *::* (any label), or a bare token (a bare label, or any label with that key); quote wildcards: --label '*::sandbox'",
    },
    deleted: { type: 'boolean', description: "List the removed projects instead, with the date of their removal ('project restore <ref>' brings one back)" },
  },
  run: (context) => {
    const selectors = context.options.list('label');
    if (context.options.flag('deleted')) {
      return listDeleted(context.registryDir, selectors);
    }
    const registry = loadRegistry(context.registryDir);
    const projects = filterProjects(registry, selectors);
    if (registry.projects.length === 0) {
      return { json: [], lines: ['no project registered; register a folder with: project add [path]'] };
    }
    if (projects.length === 0) {
      return { json: [], lines: [`no project has all the labels: ${selectors.join(', ')}`] };
    }
    const parentName = (parent: string | undefined): string => (parent === undefined ? '-' : (registry.projects.find((p) => p.id === parent)?.name ?? `${parent} (missing)`));
    return { json: projects.map(forJson), lines: table([HEADER, ...projects.map((p) => rowOf(p, parentName))]) };
  },
};
