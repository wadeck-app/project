import type { LockOptions, Registry, Scope } from '@wadeck-app/project-sdk';
import type { Options, OptionSpecs } from './args.js';
import type { InvocationLog } from './invocationLog.js';

/** Where the CLI writes: one line per call, the newline is added by the writer. */
export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** What a command produced: the same result as a machine value (--json) and as human lines. */
export interface CommandOutput {
  json: unknown;
  lines: string[];
  /** Set by a command that changed the registry: what to write in the log (names and ids, never values). */
  mutation?: string;
}

export interface Context {
  io: Io;
  env: NodeJS.ProcessEnv;
  cwd: string;
  registryDir: string;
  options: Options;
  /** Passed to every registry mutation: prints a notice when another process holds the lock. */
  lock: LockOptions;
  log: InvocationLog;
}

/** The project a command acts on, and the registry it was found in. */
export interface Target {
  registry: Registry;
  scope: Scope;
}

interface CommandBase {
  /** Full name: `add`, `paths remove`. */
  name: string;
  summary: string;
  options: OptionSpecs;
  /** Required positional arguments (after the optional project <ref>, if any). */
  args: string[];
  optionalArgs?: string[];
  /** The last required argument may be given several times (at least once). */
  variadic?: boolean;
}

/** A command that does not act on one existing project. */
export interface PlainCommand extends CommandBase {
  target: 'none';
  run: (context: Context, args: string[]) => CommandOutput | Promise<CommandOutput>;
}

/**
 * A command that acts on one project: `ref` accepts a leading optional <ref> argument as well as --project / -p,
 * `flag` only --project / -p. Without either, the environment variable then the cwd decide.
 * `explicit` requires the <ref> argument and takes no --project: for commands that must never act on an implicit target.
 */
export interface TargetCommand extends CommandBase {
  target: 'ref' | 'explicit' | 'flag';
  run: (context: Context, target: Target, args: string[]) => CommandOutput | Promise<CommandOutput>;
}

export type Command = PlainCommand | TargetCommand;
