import {
  AmbiguousReferenceError,
  DanglingParentError,
  HasChildrenError,
  InvalidIdError,
  InvalidLabelError,
  InvalidLabelSelectorError,
  InvalidPathError,
  InvalidProjectLabelError,
  InvalidQualifiedIdError,
  InvalidToolError,
  LabelTakenError,
  LockTimeoutError,
  MainPathError,
  ParentCycleError,
  PathOwnedError,
  ProjectError,
  ProjectLabelNotFoundError,
  ProjectNotFoundError,
  ProjectOptionError,
  RegistryInvalidError,
  RestoreConflictError,
  VirtualProjectError,
} from '@wadeck-app/project-sdk';

/** A request the route layer itself rejects (malformed body, missing field): 400 unless said otherwise. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export interface HttpErrorResult {
  status: number;
  body: Record<string, unknown>;
}

const NOT_FOUND = [ProjectNotFoundError, ProjectLabelNotFoundError];
const INVALID = [InvalidLabelError, InvalidProjectLabelError, InvalidLabelSelectorError, InvalidPathError, InvalidIdError, InvalidQualifiedIdError, InvalidToolError, ProjectOptionError];
const CONFLICT = [
  LabelTakenError,
  PathOwnedError,
  MainPathError,
  HasChildrenError,
  RestoreConflictError,
  AmbiguousReferenceError,
  ParentCycleError,
  DanglingParentError,
  VirtualProjectError,
];

function statusOf(error: ProjectError): number {
  if (NOT_FOUND.some((type) => error instanceof type)) {
    return 404;
  }
  if (INVALID.some((type) => error instanceof type)) {
    return 400;
  }
  if (CONFLICT.some((type) => error instanceof type)) {
    return 409;
  }
  if (error instanceof RegistryInvalidError) {
    return 422;
  }
  if (error instanceof LockTimeoutError) {
    return 503;
  }
  return 500;
}

/** What to do about it in this UI (the SDK messages name neither a button nor a CLI flag). */
function hintOf(error: ProjectError): string | undefined {
  if (error instanceof HasChildrenError) {
    const names = error.children.map((child) => child.name).join(', ');
    return `Tick 'Also remove the descendants' to remove ${error.project.name} together with its ${error.children.length} descendant(s): ${names}.`;
  }
  if (error instanceof MainPathError) {
    return 'Choose another main path first, or name the new main path when removing this one.';
  }
  return undefined;
}

function withHint(message: string, hint: string | undefined): string {
  return hint === undefined ? message : `${message}. ${hint}`;
}

/**
 * The single place where errors become HTTP answers. `message` is what the shell shows in its toast (the message of the error, then the hint);
 * `error` is the stable code; `hint` is also kept apart. A SDK error is never reworded or dropped.
 */
export function toHttpError(error: unknown): HttpErrorResult {
  if (error instanceof RequestError) {
    return { status: error.status, body: { error: 'BAD_REQUEST', message: withHint(error.message, error.hint), ...(error.hint === undefined ? {} : { hint: error.hint }) } };
  }
  if (error instanceof ProjectError) {
    const hint = hintOf(error);
    return { status: statusOf(error), body: { error: error.code, message: withHint(error.message, hint), ...(hint === undefined ? {} : { hint }) } };
  }
  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { status: 500, body: { error: 'UNEXPECTED', message: `unexpected error in the project module (this is a bug, please report it): ${cause}` } };
}

