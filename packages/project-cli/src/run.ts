import { ProjectError, defaultRegistryDir } from '@wadeck-app/project-sdk';
import { parseArgs } from './args.js';
import type { Command, CommandOutput, Context, Io } from './command.js';
import { COMMANDS } from './commands/index.js';
import { type Dispatch, splitCommand } from './dispatch.js';
import { CliError, UsageError } from './errors.js';
import { argsSyntax, commandHelp, groupHelp, topHelp } from './help.js';
import { hintFor } from './hints.js';
import { type InvocationLog, openInvocationLog } from './invocationLog.js';
import { lockOptions } from './lockNotice.js';
import { optionsOf } from './options.js';
import { resolveTarget } from './target.js';
import { currentVersion } from './version.js';

const EXIT_ERROR = 1;
const EXIT_USAGE = 2;
const EXIT_UNEXPECTED = 70;

function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function print(io: Io, lines: readonly string[]): number {
  lines.forEach((line) => io.out(line));
  return 0;
}

/** Handles argv that did not name a command: --version, --help, a group, or a mistake. */
function withoutCommand(argv: readonly string[], dispatch: Dispatch, io: Io): number {
  const [first, second] = dispatch.words;
  if (first === undefined) {
    if (argv.includes('--version')) {
      return print(io, [currentVersion()]);
    }
    if (wantsHelp(argv)) {
      return print(io, topHelp(COMMANDS));
    }
    throw new UsageError('no command given');
  }
  const subcommands = COMMANDS.filter((c) => c.name.startsWith(`${first} `)).map((c) => c.name.slice(first.length + 1));
  if (subcommands.length === 0) {
    throw new UsageError(`unknown command '${first}'`);
  }
  if (second === undefined && wantsHelp(argv)) {
    return print(io, groupHelp(first, COMMANDS));
  }
  const expected = subcommands.join(', ');
  throw new UsageError(
    second === undefined ? `'${first}' needs a subcommand: ${expected}` : `unknown subcommand '${second}' for '${first}': expected ${expected}`,
    `project ${first}`,
  );
}

/** Splits the positionals into the optional project <ref> and the command arguments, or fails with the expected syntax. */
function splitPositionals(command: Command, positionals: readonly string[]): { ref: string | undefined; args: string[] } {
  const min = command.args.length + (command.target === 'explicit' ? 1 : 0);
  const max = min + (command.optionalArgs?.length ?? 0) + (command.target === 'ref' ? 1 : 0);
  if (positionals.length < min || positionals.length > max) {
    const given = positionals.length === 0 ? 'none' : positionals.map((p) => `'${p}'`).join(', ');
    throw new UsageError(`expected ${argsSyntax(command) || 'no argument'}, got ${given}`, `project ${command.name}`);
  }
  const hasRef = command.target === 'explicit' || (command.target === 'ref' && positionals.length === min + 1);
  return { ref: hasRef ? positionals[0] : undefined, args: positionals.slice(hasRef ? 1 : 0) };
}

async function execute(command: Command, rest: readonly string[], io: Io, env: NodeJS.ProcessEnv, cwd: string, log: InvocationLog): Promise<number> {
  const label = `project ${command.name}`;
  const parsed = parseArgs(rest, optionsOf(command), label);
  if (parsed.options.flag('help')) {
    return print(io, commandHelp(command));
  }
  const { ref, args } = splitPositionals(command, parsed.positionals);
  const registryDir = defaultRegistryDir(env);
  const context: Context = { io, env, cwd, registryDir, options: parsed.options, lock: lockOptions(io), log };
  let output: CommandOutput;
  if (command.target === 'none') {
    io.err(`registry: ${registryDir}`);
    output = await command.run(context, args);
  } else {
    output = await command.run(context, resolveTarget(context, ref, label), args);
  }
  if (output.mutation !== undefined) {
    log.mutation(output.mutation);
  }
  if (parsed.options.flag('json')) {
    // A command that wrote its own output has no result to print.
    return print(io, output.json === undefined ? [] : [JSON.stringify(output.json, null, 2)]);
  }
  return print(io, output.lines);
}

interface Failure {
  exitCode: number;
  /** Stable identifier of the failure, written to the log. */
  code: string;
}

function report(error: unknown, io: Io): Failure {
  if (error instanceof UsageError) {
    io.err(`error: ${error.message}`);
    io.err(`Run '${error.command} --help' for usage.`);
    return { exitCode: EXIT_USAGE, code: 'USAGE' };
  }
  if (error instanceof CliError) {
    io.err(`error: ${error.message}`);
    return { exitCode: EXIT_ERROR, code: 'CLI_ERROR' };
  }
  if (error instanceof ProjectError) {
    io.err(`error: ${error.message}`);
    const hint = hintFor(error);
    if (hint !== undefined) {
      io.err(`hint: ${hint}`);
    }
    return { exitCode: EXIT_ERROR, code: error.code };
  }
  io.err('unexpected error (this is a bug of the project CLI, please report it with the output below):');
  io.err(error instanceof Error ? (error.stack ?? String(error)) : String(error));
  return { exitCode: EXIT_UNEXPECTED, code: 'UNEXPECTED' };
}

/**
 * Runs the CLI and returns the exit code: 0 success, 1 a ProjectError, 2 a usage error, 70 an unexpected exception.
 * Never touches `process`: the caller supplies argv, the writers, the environment and the working directory.
 * Every invocation is logged in <config folder>/logs (see invocationLog.ts).
 */
export async function run(argv: readonly string[], io: Io, env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const log = openInvocationLog(defaultRegistryDir(env), argv, (reason) => io.err(`warning: could not write the log (${reason})`));
  try {
    const dispatch = splitCommand(argv, COMMANDS.map((c) => c.name));
    const command = COMMANDS.find((c) => c.name === dispatch.name);
    const exitCode = command === undefined ? withoutCommand(argv, dispatch, io) : await execute(command, dispatch.rest, io, env, cwd, log);
    log.outcome(exitCode);
    return exitCode;
  } catch (error) {
    const failure = report(error, io);
    log.outcome(failure.exitCode, failure.code);
    return failure.exitCode;
  }
}
