import type { OptionSpecs } from './args.js';
import type { Command } from './command.js';
import { globalOptions, optionsOf } from './options.js';

const SUMMARY = 'project - register and inspect the projects shared by the task, flow and queue CLIs';
const REGISTRY_NOTE = 'The registry lives in $XDG_CONFIG_HOME/project, else ~/.config/project.';

/** `[<ref>] <new-name>`: the positional arguments of a command. */
export function argsSyntax(command: Command): string {
  const ref = command.target === 'ref' ? ['[<ref>]'] : command.target === 'explicit' ? ['<ref>'] : [];
  const required = command.args.map((a, i) => (command.variadic === true && i === command.args.length - 1 ? `<${a}>...` : `<${a}>`));
  return [...ref, ...required, ...(command.optionalArgs ?? []).map((a) => `[${a}]`)].join(' ');
}

/** `project paths add [<ref>] <path>` */
export function usageLine(command: Command): string {
  return `project ${command.name} ${argsSyntax(command)}`.trimEnd();
}

function optionLines(specs: OptionSpecs): string[] {
  const rows = Object.entries(specs).map(([name, spec]) => {
    const short = spec.short === undefined ? '    ' : `-${spec.short}, `;
    const value = spec.type === 'boolean' ? '' : ` <${spec.valueName ?? name}>`;
    return { left: `${short}--${name}${value}`, description: spec.description };
  });
  const width = Math.max(...rows.map((row) => row.left.length));
  return rows.map((row) => `  ${row.left.padEnd(width)}  ${row.description}`);
}

function commandLines(commands: readonly Command[]): string[] {
  const width = Math.max(...commands.map((c) => usageLine(c).length));
  return commands.map((c) => `  ${usageLine(c).padEnd(width)}  ${c.summary}`);
}

export function topHelp(commands: readonly Command[]): string[] {
  return [
    SUMMARY,
    '',
    'Usage: project <command> [options]',
    '',
    'Commands:',
    ...commandLines(commands),
    '',
    'Options (all commands):',
    ...optionLines({ ...globalOptions(), version: { type: 'boolean', description: 'Print the version (without a command)' } }),
    '',
    "Run 'project <command> --help' for the options of one command.",
    REGISTRY_NOTE,
  ];
}

export function groupHelp(group: string, commands: readonly Command[]): string[] {
  return [`Usage: project ${group} <subcommand>`, '', 'Subcommands:', ...commandLines(commands.filter((c) => c.name.startsWith(`${group} `)))];
}

export function commandHelp(command: Command): string[] {
  return [`Usage: ${usageLine(command)} [options]`, '', command.summary, '', 'Options:', ...optionLines(optionsOf(command))];
}
