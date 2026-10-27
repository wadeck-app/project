import { describeProject, restoreProject } from '@wadeck-app/project-sdk';
import type { PlainCommand } from '../command.js';
import { forJson } from '../format.js';

export const restoreCommand: PlainCommand = {
  name: 'restore',
  summary: 'Bring a removed project back, with its data (see: project list --deleted)',
  target: 'none',
  args: ['ref'],
  options: { recursive: { type: 'boolean', description: 'Also restore the removed projects below it, parents first, all or none' } },
  run: async (context, [ref]) => {
    const restored = await restoreProject(context.registryDir, ref!, { recursive: context.options.flag('recursive'), lock: context.lock });
    return {
      json: restored.map(forJson),
      lines: restored.map((p) => `restored ${describeProject(p)}`),
      mutation: `restore project ${restored.map(describeProject).join(', ')}`,
    };
  },
};
