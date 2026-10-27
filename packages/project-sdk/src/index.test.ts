import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as sdk from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

const FUNCTIONS = [
  'defaultRegistryDir', 'projectDir', 'findProjectIncludingDeleted', 'extractProjectOption', 'resolveProjectFromArgs', 'mainPath', 'isVirtual', 'describeProject', 'deriveName', 'parseLabel', 'formatLabel', 'normalizeProjectLabel', 'labelsOf', 'hasLabel', 'matchesSelectors', 'filterProjects', 'addLabels', 'removeLabels', 'generateId', 'isIdLike', 'normalizeLabel', 'normalizePath', 'toNativePath', 'pathKey', 'isSameOrInside', 'assertDirectory',
  'writeFileAtomic', 'withRegistryLock', 'lockFilePath',
  'loadRegistry', 'loadDeleted', 'registryFilePath', 'deletedFilePath', 'validateRegistry',
  'addProject', 'renameProject', 'addAlias', 'removeAlias', 'setParent', 'setGit', 'removeProject',
  'addPath', 'removePath', 'movePath', 'setMain',
  'resolveReference', 'levenshtein', 'findProjectForPath', 'resolveScope', 'describeResolution', 'requirePath',
  'getChain', 'getChildren', 'getDescendants', 'getAncestors', 'projectToolDir', 'getConfigLayers', 'validateLayer', 'mergeLayers',
] as const;

const ERRORS = [
  'InvalidLabelError', 'LabelTakenError', 'InvalidPathError', 'PathOwnedError', 'MainPathError', 'HasChildrenError',
  'InvalidToolError', 'InvalidIdError', 'AtomicWriteError', 'LockTimeoutError', 'LockLostError', 'RegistryCorruptError',
  'RegistryInvalidError', 'ProjectNotFoundError', 'AmbiguousReferenceError', 'NoProjectInScopeError', 'VirtualProjectError',
  'DanglingParentError', 'ParentCycleError', 'ConfigSchemaError', 'UnsupportedSchemaVersionError', 'InvalidProjectLabelError', 'InvalidLabelSelectorError', 'ProjectLabelNotFoundError', 'ProjectOptionError',
] as const;

const DETAILS: Record<string, unknown> = {
  LabelTakenError: { kind: 'name', label: 'x' },
  NoProjectInScopeError: { cwd: '/', registered: [], hint: 'h' },
  HasChildrenError: { project: { id: '00000001', name: 'a' }, children: [] },
  AmbiguousReferenceError: { ref: 'x', candidates: [] },
  ProjectNotFoundError: { ref: 'x', suggestions: [] },
  UnsupportedSchemaVersionError: { file: 'f', found: 2, supported: 1 },
  InvalidProjectLabelError: { input: 'x', reason: 'r' },
  InvalidLabelSelectorError: { input: 'x', reason: 'r' },
  ProjectOptionError: { kind: 'repeated', option: '-p' },
  ProjectLabelNotFoundError: { label: 'x', project: { id: '00000001', name: 'a' } },
};

function makeError(name: string, message: string): sdk.ProjectError {
  const ErrorClass = (sdk as unknown as Record<string, new (message: string, details?: unknown) => sdk.ProjectError>)[name]!;
  return new ErrorClass(message, DETAILS[name]);
}

describe('public API', () => {
  it.each(FUNCTIONS)('exports the function %s', (name) => {
    expect(typeof (sdk as Record<string, unknown>)[name]).toBe('function');
  });

  it('exports ProjectError with an explicit code', () => {
    const error = new sdk.ProjectError('SOME_CODE', 'message');
    expect(error.code).toBe('SOME_CODE');
    expect(error.name).toBe('ProjectError');
  });

  it.each(ERRORS)('exports %s as a ProjectError with a stable code', (name) => {
    const error = makeError(name, 'message');
    expect(error).toBeInstanceOf(sdk.ProjectError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.code).toMatch(/^[A-Z_]+$/);
  });

  it('gives every error class a distinct code', () => {
    const codes = ERRORS.map((name) => {
      return makeError(name, 'm').code;
    });
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is loadable as CommonJS from the build', () => {
    const cjs = join(here, '..', 'dist', 'cjs', 'index.cjs');
    // A missing build is a failure, never a skip.
    if (!existsSync(cjs)) {
      throw new Error(`${cjs} is missing: run 'npm run build' before 'npm test'`);
    }
    const loaded = createRequire(import.meta.url)(cjs) as Record<string, unknown>;
    for (const name of [...FUNCTIONS, ...ERRORS, 'ProjectError']) {
      expect(loaded[name], name).toBeDefined();
    }
  });
});
