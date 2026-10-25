import { ProjectOptionError } from './errors.js';
import { type Scope, resolveScope } from './resolution.js';
import type { Registry } from './types.js';

export interface ProjectOption {
  /** The arguments without the project flag and its value (`--` and what follows it are kept untouched). */
  args: string[];
  /** The value of `-p` / `--project`, as typed. */
  flag?: string;
  /** The value of the environment variable, unless it is blank. */
  env?: string;
}

const WHAT = 'the name, an alias or the id of a project (project list shows them)';

function missingValue(option: string): ProjectOptionError {
  return new ProjectOptionError(`${option} needs a value: ${WHAT}`, { kind: 'missing-value', option });
}

/**
 * Takes `-p <ref>`, `--project <ref>` or `--project=<ref>` out of the arguments, wherever it is, so that every CLI
 * accepts the flag the same way. A flag without value (last argument, or followed by another flag) and a flag given twice are errors:
 * nothing is guessed. Nothing after `--` is read. The environment variable `envName` counts as unset when blank.
 * Which of the flag and the variable wins is up to resolveScope.
 */
export function extractProjectOption(argv: readonly string[], env: NodeJS.ProcessEnv, envName: string): ProjectOption {
  const args: string[] = [];
  let flag: string | undefined;
  let firstOption: string | undefined;

  const take = (option: string, value: string): void => {
    if (firstOption !== undefined) {
      throw new ProjectOptionError(`the project is given twice (${firstOption} and ${option}); pass it once`, { kind: 'repeated', option });
    }
    firstOption = option;
    flag = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      args.push(...argv.slice(i));
      break;
    }
    if (arg === '-p' || arg === '--project') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw missingValue(arg);
      }
      take(arg, value);
      i++;
    } else if (arg.startsWith('--project=')) {
      take(arg, arg.slice('--project='.length));
    } else {
      args.push(arg);
    }
  }

  const fromEnv = env[envName];
  return {
    args,
    ...(flag === undefined ? {} : { flag }),
    ...(fromEnv === undefined || fromEnv.trim() === '' ? {} : { env: fromEnv }),
  };
}

/** extractProjectOption then resolveScope (flag, then the environment variable, then the cwd): the project of a command and its other arguments. */
export function resolveProjectFromArgs(registry: Registry, argv: readonly string[], env: NodeJS.ProcessEnv, envName: string, cwd: string): { scope: Scope; args: string[] } {
  const option = extractProjectOption(argv, env, envName);
  const scope = resolveScope(registry, {
    cwd,
    envName,
    ...(option.flag === undefined ? {} : { flag: option.flag }),
    ...(option.env === undefined ? {} : { env: option.env }),
  });
  return { scope, args: option.args };
}
