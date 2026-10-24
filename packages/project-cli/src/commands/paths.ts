import { type Project, addPath, describeProject, movePath, normalizePath, removePath, setMain, toNativePath } from '@wadeck-app/project-sdk';
import type { CommandOutput, TargetCommand } from '../command.js';
import { forJson, pathLines } from '../format.js';

/** The sentence about the change, then the resulting paths of the project; `mutation` is the line for the log. */
function result(project: Project, sentence: string, mutation: string): CommandOutput {
  return { json: forJson(project), lines: [sentence, '  paths:', ...pathLines(project, '    ')], mutation };
}

export const pathsAddCommand: TargetCommand = {
  name: 'paths add',
  summary: 'Register one more folder (a worktree, a variant) for a project',
  target: 'ref',
  args: ['path'],
  options: { main: { type: 'boolean', description: 'Make it the main path (the first path of a project always is)' } },
  run: async (context, { scope }, [path]) => {
    const absolute = normalizePath(path!, context.cwd);
    const project = await addPath(context.registryDir, scope.project.id, absolute, { main: context.options.flag('main') }, { lock: context.lock });
    return result(project, `added path ${toNativePath(absolute)} to ${describeProject(project)}`, `paths add ${describeProject(project)}: ${absolute}`);
  },
};

export const pathsRemoveCommand: TargetCommand = {
  name: 'paths remove',
  summary: 'Unregister a folder of a project (the folder itself is not touched)',
  target: 'ref',
  args: ['path'],
  options: { 'new-main': { type: 'string', valueName: 'path', description: 'Path that becomes main when the removed one was' } },
  run: async (context, { scope }, [path]) => {
    const absolute = normalizePath(path!, context.cwd);
    const newMain = context.options.value('new-main');
    const flags = newMain === undefined ? {} : { newMain: normalizePath(newMain, context.cwd) };
    const project = await removePath(context.registryDir, scope.project.id, absolute, flags, { lock: context.lock });
    return result(project, `removed path ${toNativePath(absolute)} from ${describeProject(project)}`, `paths remove ${describeProject(project)}: ${absolute}`);
  },
};

export const pathsMoveCommand: TargetCommand = {
  name: 'paths move',
  summary: 'Replace a registered folder by the one it was moved to (id and main flag are kept)',
  target: 'ref',
  args: ['from', 'to'],
  options: {},
  run: async (context, { scope }, [from, to]) => {
    const source = normalizePath(from!, context.cwd);
    const target = normalizePath(to!, context.cwd);
    const project = await movePath(context.registryDir, scope.project.id, source, target, { lock: context.lock });
    return result(project, `moved path ${toNativePath(source)} to ${toNativePath(target)} in ${describeProject(project)}`, `paths move ${describeProject(project)}: ${source} -> ${target}`);
  },
};

export const pathsMainCommand: TargetCommand = {
  name: 'paths main',
  summary: 'Choose the main path of a project, used when a command runs outside all its paths',
  target: 'ref',
  args: ['path'],
  options: {},
  run: async (context, { scope }, [path]) => {
    const absolute = normalizePath(path!, context.cwd);
    const project = await setMain(context.registryDir, scope.project.id, absolute, { lock: context.lock });
    return result(project, `main path of ${describeProject(project)} is now ${toNativePath(absolute)}`, `paths main ${describeProject(project)}: ${absolute}`);
  },
};
