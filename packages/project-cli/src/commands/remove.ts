import { describeProject, removeProject } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';
import { projectFolder } from '../format.js';

export const removeCommand: TargetCommand = {
  name: 'remove',
  summary: 'Remove a project from the registry (soft delete: its data folder is kept)',
  target: 'explicit',
  args: [],
  options: { recursive: { type: 'boolean', description: 'Also remove all the projects that inherit from it' } },
  run: async (context, { scope }) => {
    const removed = await removeProject(context.registryDir, scope.project.id, { recursive: context.options.flag('recursive') }, { lock: context.lock });
    return {
      json: removed,
      lines: removed.map((p) => `removed ${describeProject(p)}; its data folder was kept: ${projectFolder(context.registryDir, p)}`),
      mutation: `remove ${removed.map(describeProject).join(', ')}`,
    };
  },
};
