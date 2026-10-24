import { filterProjects, loadRegistry, mainPath } from '@wadeck-app/project-sdk';
import type { PlainCommand } from '../command.js';
import { forJson, table } from '../format.js';

export const listCommand: PlainCommand = {
  name: 'list',
  summary: 'List the registered projects',
  target: 'none',
  args: [],
  options: {
    label: { type: 'list', valueName: 'selector', description: "Only the projects that have this label: 'key::value', a key, or a bare value; repeat to require several (AND)" },
  },
  run: (context) => {
    const registry = loadRegistry(context.registryDir);
    const selectors = context.options.list('label');
    const projects = filterProjects(registry, selectors);
    if (registry.projects.length === 0) {
      return { json: [], lines: ['no project registered; register a folder with: project add [path]'] };
    }
    if (projects.length === 0) {
      return { json: [], lines: [`no project has all the labels: ${selectors.join(', ')}`] };
    }
    const parentName = (parent: string | undefined): string => (parent === undefined ? '-' : (registry.projects.find((p) => p.id === parent)?.name ?? `${parent} (missing)`));
    const rows = projects.map((p) => [p.id, p.name, p.aliases.join(',') || '-', parentName(p.parent), (p.labels ?? []).join(',') || '-', mainPath(p) ?? '(virtual)']);
    return { json: projects.map(forJson), lines: table([['ID', 'NAME', 'ALIASES', 'PARENT', 'LABELS', 'MAIN PATH'], ...rows]) };
  },
};
