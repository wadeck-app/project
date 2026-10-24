import { describeProject, resolveReference, setParent } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';
import { forJson } from '../format.js';

export const parentSetCommand: TargetCommand = {
  name: 'parent set',
  summary: 'Make a project inherit its configuration from another one',
  target: 'ref',
  args: ['parent'],
  options: {},
  run: async (context, { scope, registry }, [parentRef]) => {
    const project = await setParent(context.registryDir, scope.project.id, parentRef!, { lock: context.lock });
    const parent = resolveReference(registry, parentRef!);
    return { json: forJson(project), lines: [`${describeProject(project)} now inherits from ${describeProject(parent)}`], mutation: `parent set ${describeProject(project)} -> ${describeProject(parent)}` };
  },
};

export const parentClearCommand: TargetCommand = {
  name: 'parent clear',
  summary: 'Remove the parent of a project',
  target: 'ref',
  args: [],
  options: {},
  run: async (context, { scope }) => {
    const project = await setParent(context.registryDir, scope.project.id, null, { lock: context.lock });
    return { json: forJson(project), lines: [`${describeProject(project)} has no parent anymore`], mutation: `parent clear on ${describeProject(project)}` };
  },
};
