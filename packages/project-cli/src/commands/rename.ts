import { renameProject } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';

export const renameCommand: TargetCommand = {
  name: 'rename',
  summary: 'Change the name of a project (its id and data are kept)',
  target: 'ref',
  args: ['new-name'],
  options: {},
  run: async (context, { scope }, [newName]) => {
    const project = await renameProject(context.registryDir, scope.project.id, newName!, { lock: context.lock });
    return { json: project, lines: [`renamed ${scope.project.name} -> ${project.name} (${project.id})`], mutation: `rename ${scope.project.name} (${project.id}) -> ${project.name}` };
  },
};
