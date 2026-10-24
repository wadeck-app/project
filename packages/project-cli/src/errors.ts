/** The command line is wrong (unknown command or option, missing argument): exit code 2 with a hint to run --help. */
export class UsageError extends Error {
  /** Command whose `--help` explains the usage, as typed: 'project' or 'project add'. */
  readonly command: string;

  constructor(message: string, command = 'project') {
    super(message);
    this.name = 'UsageError';
    this.command = command;
  }
}

/** A command failed for a reason the user can act on (exit code 1, message only, no stack). */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
