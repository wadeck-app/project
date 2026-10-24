import { describeProject, setGit } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';
import { forJson } from '../format.js';

export const gitSetCommand: TargetCommand = {
  name: 'git set',
  summary: 'Set the git repository of a project (stored as given, not validated)',
  target: 'ref',
  args: ['value'],
  options: {},
  run: async (context, { scope }, [value]) => {
    const project = await setGit(context.registryDir, scope.project.id, value!, { lock: context.lock });
    return { json: forJson(project), lines: [`git of ${describeProject(project)} is now ${value}`], mutation: `git set on ${describeProject(project)}` };
  },
};

export const gitClearCommand: TargetCommand = {
  name: 'git clear',
  summary: 'Remove the git repository of a project',
  target: 'ref',
  args: [],
  options: {},
  run: async (context, { scope }) => {
    const project = await setGit(context.registryDir, scope.project.id, null, { lock: context.lock });
    return { json: forJson(project), lines: [`git of ${describeProject(project)} was cleared`], mutation: `git clear on ${describeProject(project)}` };
  },
};
