import { loadRegistry, mainPath } from '@wadeck-app/project-sdk';
import type { PlainCommand } from '../command.js';
import { table } from '../format.js';

export const listCommand: PlainCommand = {
  name: 'list',
  summary: 'List the registered projects',
  target: 'none',
  args: [],
  options: {},
  run: (context) => {
    const { projects } = loadRegistry(context.registryDir);
    if (projects.length === 0) {
      return { json: projects, lines: ['no project registered; register a folder with: project add [path]'] };
    }
    const parentName = (parent: string | undefined): string => (parent === undefined ? '-' : (projects.find((p) => p.id === parent)?.name ?? `${parent} (missing)`));
    const rows = projects.map((p) => [p.id, p.name, p.aliases.join(',') || '-', parentName(p.parent), mainPath(p) ?? '(virtual)']);
    return { json: projects, lines: table([['ID', 'NAME', 'ALIASES', 'PARENT', 'MAIN PATH'], ...rows]) };
  },
};
