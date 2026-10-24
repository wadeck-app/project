import type { OptionSpecs } from './args.js';
import type { Command } from './command.js';

export const PROJECT_ENV = 'PROJECT_PROJECT';

const PROJECT_OPTION: OptionSpecs = {
  project: {
    type: 'string',
    short: 'p',
    valueName: 'ref',
    description: `Project to act on (name, alias or id). Default: ${PROJECT_ENV}, then the project that contains the current folder`,
  },
};

const COMMON_OPTIONS: OptionSpecs = {
  json: { type: 'boolean', description: 'Print the result as JSON on stdout' },
  help: { type: 'boolean', short: 'h', description: 'Show this help' },
};

/** Every option a command accepts: its own, then --project (only when it acts on a project), --json and --help. */
export function optionsOf(command: Command): OptionSpecs {
  return { ...command.options, ...(command.target === 'ref' || command.target === 'flag' ? PROJECT_OPTION : {}), ...COMMON_OPTIONS };
}

/** The options shown in the top-level help (those every acting command shares). */
export function globalOptions(): OptionSpecs {
  return { ...PROJECT_OPTION, ...COMMON_OPTIONS };
}
