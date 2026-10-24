import { describeProject, getChain, toNativePath } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';
import { forJson, labelList, pathLines, projectFolder } from '../format.js';

export const showCommand: TargetCommand = {
  name: 'show',
  summary: 'Show a project: aliases, parent chain, paths, git and where its tool folders live',
  target: 'ref',
  args: [],
  options: {},
  run: (context, { registry, scope }) => {
    const { project } = scope;
    const chain = getChain(registry, project);
    const folder = projectFolder(context.registryDir, project);
    return {
      json: { ...forJson(project), chain: chain.map(({ id, name }) => ({ id, name })), folder },
      lines: [
        describeProject(project),
        `  aliases: ${project.aliases.join(', ') || 'none'}`,
        `  labels: ${labelList(project)}`,
        `  parent chain: ${chain.length > 1 ? chain.map((p) => p.name).join(' > ') : 'none'}`,
        '  paths:',
        ...pathLines(project, '    '),
        `  git: ${project.git ?? 'none'}`,
        `  folder: ${toNativePath(folder)}`,
      ],
    };
  },
};
