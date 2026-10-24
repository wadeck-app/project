import { describeProject } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';

export const resolveCommand: TargetCommand = {
  name: 'resolve',
  summary: 'Show which project is in scope and why (--project, environment variable or current folder)',
  target: 'flag',
  args: [],
  options: {},
  run: (context, { scope }) => {
    const { project, path, pathVia, source, via } = scope;
    return {
      json: { id: project.id, name: project.name, source, via, path, pathVia, registryDir: context.registryDir },
      lines: [
        `project: ${describeProject(project)}`,
        `source: ${via}`,
        `path: ${path === undefined ? 'none (virtual project)' : `${path} (${pathVia})`}`,
        `registry: ${context.registryDir}`,
      ],
    };
  },
};
