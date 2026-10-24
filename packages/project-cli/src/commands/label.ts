import { addLabels, describeProject, removeLabels } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';
import { forJson } from '../format.js';

const plural = (count: number): string => `${count} label${count === 1 ? '' : 's'}`;

export const labelAddCommand: TargetCommand = {
  name: 'label add',
  summary: "Add labels ('key::value' or a bare value) to a project; a label it already has is left as it is",
  target: 'explicit',
  args: ['label'],
  variadic: true,
  options: {},
  run: async (context, { scope }, labels) => {
    const before = scope.project.labels ?? [];
    const project = await addLabels(context.registryDir, scope.project.id, labels, { lock: context.lock });
    const added = (project.labels ?? []).filter((label) => !before.includes(label));
    const line =
      added.length === 0
        ? `${describeProject(project)} already has ${labels.join(', ')}`
        : `added ${plural(added.length)} to ${describeProject(project)}: ${added.join(', ')}`;
    return {
      json: forJson(project),
      lines: [line],
      ...(added.length === 0 ? {} : { mutation: `label add ${describeProject(project)} ${added.map((label) => `+${label}`).join(' ')}` }),
    };
  },
};

export const labelRemoveCommand: TargetCommand = {
  name: 'label remove',
  summary: 'Remove labels from a project; a label it does not have is an error',
  target: 'explicit',
  args: ['label'],
  variadic: true,
  options: {},
  run: async (context, { scope }, labels) => {
    const before = scope.project.labels ?? [];
    const project = await removeLabels(context.registryDir, scope.project.id, labels, { lock: context.lock });
    const removed = before.filter((label) => !(project.labels ?? []).includes(label));
    return {
      json: forJson(project),
      lines: [`removed ${plural(removed.length)} from ${describeProject(project)}: ${removed.join(', ')}`],
      mutation: `label remove ${describeProject(project)} ${removed.map((label) => `-${label}`).join(' ')}`,
    };
  },
};
