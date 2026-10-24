/** Identity of a project as carried by error data. */
export interface ProjectRef {
  id: string;
  name: string;
}

/** Base of every error thrown by the SDK. `code` is stable and meant for programmatic handling. */
export class ProjectError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidLabelError extends ProjectError {
  constructor(message: string) {
    super('INVALID_LABEL', message);
  }
}

export class LabelTakenError extends ProjectError {
  readonly kind: 'name' | 'alias';
  readonly label: string;
  /** The project that already uses the label; undefined when the label is requested twice in the same request. */
  readonly owner: ProjectRef | undefined;

  constructor(message: string, details: { kind: 'name' | 'alias'; label: string; owner?: ProjectRef }) {
    super('LABEL_TAKEN', message);
    this.kind = details.kind;
    this.label = details.label;
    this.owner = details.owner;
  }
}

export class InvalidPathError extends ProjectError {
  /** The offending path, when the error is about one path. */
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super('INVALID_PATH', message);
    this.path = path;
  }
}

export class PathOwnedError extends ProjectError {
  constructor(message: string) {
    super('PATH_OWNED', message);
  }
}

export class MainPathError extends ProjectError {
  constructor(message: string) {
    super('MAIN_PATH', message);
  }
}

export class HasChildrenError extends ProjectError {
  readonly project: ProjectRef;
  /** All descendants of the project, parents before children. */
  readonly children: ProjectRef[];

  constructor(message: string, details: { project: ProjectRef; children: ProjectRef[] }) {
    super('HAS_CHILDREN', message);
    this.project = details.project;
    this.children = details.children;
  }
}

export class InvalidToolError extends ProjectError {
  constructor(message: string) {
    super('INVALID_TOOL', message);
  }
}

export class AtomicWriteError extends ProjectError {
  constructor(message: string) {
    super('ATOMIC_WRITE_FAILED', message);
  }
}

export class LockTimeoutError extends ProjectError {
  constructor(message: string) {
    super('LOCK_TIMEOUT', message);
  }
}

export class LockLostError extends ProjectError {
  constructor(message: string) {
    super('LOCK_LOST', message);
  }
}

export class RegistryCorruptError extends ProjectError {
  constructor(message: string) {
    super('REGISTRY_CORRUPT', message);
  }
}

export class RegistryInvalidError extends ProjectError {
  constructor(message: string) {
    super('REGISTRY_INVALID', message);
  }
}

export class ProjectNotFoundError extends ProjectError {
  readonly ref: string;
  /** Close names or aliases, closest first; suggestions only, never selected. */
  readonly suggestions: { text: string; project: ProjectRef }[];

  constructor(message: string, details: { ref: string; suggestions: { text: string; project: ProjectRef }[] }) {
    super('PROJECT_NOT_FOUND', message);
    this.ref = details.ref;
    this.suggestions = details.suggestions;
  }
}

export class AmbiguousReferenceError extends ProjectError {
  readonly ref: string;
  readonly candidates: ProjectRef[];

  constructor(message: string, details: { ref: string; candidates: ProjectRef[] }) {
    super('AMBIGUOUS_REFERENCE', message);
    this.ref = details.ref;
    this.candidates = details.candidates;
  }
}

export class NoProjectInScopeError extends ProjectError {
  readonly cwd: string;
  /** Names of all registered projects (the message lists only the first ones). */
  readonly registered: string[];
  /** What to do about it, ready to print on its own line after the message. */
  readonly hint: string;

  constructor(message: string, details: { cwd: string; registered: string[]; hint: string }) {
    super('NO_PROJECT_IN_SCOPE', message);
    this.cwd = details.cwd;
    this.registered = details.registered;
    this.hint = details.hint;
  }
}

export class VirtualProjectError extends ProjectError {
  constructor(message: string) {
    super('VIRTUAL_PROJECT', message);
  }
}

export class DanglingParentError extends ProjectError {
  constructor(message: string) {
    super('DANGLING_PARENT', message);
  }
}

export class ParentCycleError extends ProjectError {
  constructor(message: string) {
    super('PARENT_CYCLE', message);
  }
}

export class ConfigSchemaError extends ProjectError {
  constructor(message: string) {
    super('CONFIG_SCHEMA', message);
  }
}

export class InvalidIdError extends ProjectError {
  constructor(message: string) {
    super('INVALID_ID', message);
  }
}

export class UnsupportedSchemaVersionError extends ProjectError {
  readonly file: string;
  /** The schemaVersion read from the file (undefined when the file has none). */
  readonly found: unknown;
  readonly supported: number;

  constructor(message: string, details: { file: string; found: unknown; supported: number }) {
    super('UNSUPPORTED_SCHEMA_VERSION', message);
    this.file = details.file;
    this.found = details.found;
    this.supported = details.supported;
  }
}

export class InvalidProjectLabelError extends ProjectError {
  /** The label (or selector) as it was given. */
  readonly input: string;
  readonly reason: string;

  constructor(message: string, details: { input: string; reason: string }) {
    super('INVALID_PROJECT_LABEL', message);
    this.input = details.input;
    this.reason = details.reason;
  }
}

export class ProjectLabelNotFoundError extends ProjectError {
  readonly label: string;
  readonly project: ProjectRef;

  constructor(message: string, details: { label: string; project: ProjectRef }) {
    super('PROJECT_LABEL_NOT_FOUND', message);
    this.label = details.label;
    this.project = details.project;
  }
}

export class InvalidLabelSelectorError extends ProjectError {
  /** The selector as it was given. */
  readonly input: string;
  readonly reason: string;

  constructor(message: string, details: { input: string; reason: string }) {
    super('INVALID_LABEL_SELECTOR', message);
    this.input = details.input;
    this.reason = details.reason;
  }
}
