import { describeResolution, loadRegistry, resolveScope } from '@wadeck-app/project-sdk';
import type { Context, Target } from './command.js';
import { UsageError } from './errors.js';
import { PROJECT_ENV } from './options.js';

/**
 * Finds the project a command acts on (explicit <ref> argument, else --project, else the environment variable, else the cwd)
 * and states how it was found on stderr, as the first line of the command.
 */
export function resolveTarget(context: Context, ref: string | undefined, label: string): Target {
  const flag = context.options.value('project');
  if (ref !== undefined && flag !== undefined) {
    throw new UsageError(`both the <ref> argument ('${ref}') and --project ('${flag}') were given; pass only one`, label);
  }
  const registry = loadRegistry(context.registryDir);
  const scope = resolveScope(registry, {
    cwd: context.cwd,
    ...(ref !== undefined ? { flag: ref, label: '<ref> argument' } : flag !== undefined ? { flag } : {}),
    ...(context.env[PROJECT_ENV] === undefined ? {} : { env: context.env[PROJECT_ENV] }),
    envName: PROJECT_ENV,
  });
  context.io.err(describeResolution(scope, { registryDir: context.registryDir }));
  return { registry, scope };
}
