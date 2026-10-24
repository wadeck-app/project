import type { TargetCommand } from '../command.js';
import { projectFolder } from '../format.js';

export const pathCommand: TargetCommand = {
  name: 'path',
  summary: 'Print the folder of a project in the registry (<registry>/projects/<id>)',
  target: 'ref',
  args: [],
  options: {},
  run: (context, { scope }) => {
    const path = projectFolder(context.registryDir, scope.project);
    return { json: { path }, lines: [path] };
  },
};
