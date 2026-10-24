import { addAlias, describeProject, removeAlias } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';

export const aliasAddCommand: TargetCommand = {
  name: 'alias add',
  summary: 'Add an alias to a project',
  target: 'ref',
  args: ['alias'],
  options: {},
  run: async (context, { scope }, [alias]) => {
    const project = await addAlias(context.registryDir, scope.project.id, alias!, { lock: context.lock });
    return { json: project, lines: [`added alias '${alias}' to ${describeProject(project)}`] };
  },
};

export const aliasRemoveCommand: TargetCommand = {
  name: 'alias remove',
  summary: 'Remove an alias from a project',
  target: 'ref',
  args: ['alias'],
  options: {},
  run: async (context, { scope }, [alias]) => {
    const project = await removeAlias(context.registryDir, scope.project.id, alias!, { lock: context.lock });
    return { json: project, lines: [`removed alias '${alias}' from ${describeProject(project)}`] };
  },
};
