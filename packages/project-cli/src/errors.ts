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
