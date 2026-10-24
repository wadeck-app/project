import { InvalidLabelError, LabelTakenError, addProject, deriveName, describeProject, normalizePath } from '@wadeck-app/project-sdk';
import type { PlainCommand } from '../command.js';
import { UsageError } from '../errors.js';
import { pathLines } from '../format.js';

const LABEL = 'project add';

/** The name suggested by the folder, or a usage error that says how to give one explicitly. */
function nameFromFolder(path: string): string {
  try {
    return deriveName(path);
  } catch (error) {
    if (error instanceof InvalidLabelError) {
      throw new UsageError(`${error.message} (--name <name>)`, LABEL);
    }
    throw error;
  }
}

export const addCommand: PlainCommand = {
  name: 'add',
  summary: 'Register a folder (default: the current one) as a project',
  target: 'none',
  args: [],
  optionalArgs: ['path'],
  options: {
    name: { type: 'string', description: 'Project name (default: the lowercased folder name)' },
    alias: { type: 'list', description: 'Alias, repeatable' },
    parent: { type: 'string', valueName: 'ref', description: 'Parent project (name, alias or id) it inherits its configuration from' },
    git: { type: 'string', valueName: 'value', description: 'Git repository of the project, stored as given' },
    virtual: { type: 'boolean', description: 'Register a project without path, to hold configuration shared by others (needs --name)' },
  },
  run: async (context, args) => {
    const { options } = context;
    const virtual = options.flag('virtual');
    if (virtual && args.length > 0) {
      throw new UsageError(`--virtual registers a project without path, but the path '${args[0]}' was given; remove one of them`, LABEL);
    }
    if (virtual && options.value('name') === undefined) {
      throw new UsageError('--virtual needs --name <name>: there is no folder to take the name from', LABEL);
    }
    const path = virtual ? undefined : normalizePath(args[0] ?? '.', context.cwd);
    const explicitName = options.value('name');
    const name = explicitName ?? nameFromFolder(path!);
    const parent = options.value('parent');
    const git = options.value('git');
    try {
      const project = await addProject(
        context.registryDir,
        { name, aliases: options.list('alias'), ...(path === undefined ? {} : { path }), ...(parent === undefined ? {} : { parent }), ...(git === undefined ? {} : { git }) },
        { lock: context.lock },
      );
      return { json: project, lines: [`added ${describeProject(project)}`, ...pathLines(project, '  path: ')], mutation: `add project ${describeProject(project)}` };
    } catch (error) {
      if (explicitName === undefined && error instanceof LabelTakenError && error.kind === 'name') {
        throw new UsageError(`${error.message}; the name comes from the folder: pass --name <name>`, LABEL);
      }
      throw error;
    }
  },
};
