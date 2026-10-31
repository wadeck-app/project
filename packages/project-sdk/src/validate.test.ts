import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DanglingParentError, InvalidPathError, ParentCycleError, RegistryInvalidError } from './errors.js';
import { normalizePath, pathKey } from './paths.js';
import { makeProject, makeRegistry } from './testHelpers.js';
import { validateRegistry } from './validate.js';

describe('validateRegistry', () => {
  let dir: string;
  let pathA: string;
  let pathB: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-sdk-validate-'));
    pathA = normalizePath(join(dir, 'a'));
    pathB = normalizePath(join(dir, 'b'));
    mkdirSync(pathA);
    mkdirSync(pathB);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  it('accepts an empty registry and a coherent one', () => {
    expect(() => validateRegistry(makeRegistry(), { checkPaths: true })).not.toThrow();
    const registry = makeRegistry(
      makeProject(1, { aliases: ['one'], paths: [{ path: pathA, main: true }] }),
      makeProject(2, { parent: '00000001', paths: [{ path: pathB, main: true }] }),
      makeProject(3),
    );
    expect(() => validateRegistry(registry, { checkPaths: true })).not.toThrow();
  });

  describe('labels and ids', () => {
    it.each([
      ['duplicate names', makeRegistry(makeProject(1, { name: 'x' }), makeProject(2, { name: 'x' })), /'x'.*00000001.*00000002/s],
      ['an alias equal to another name', makeRegistry(makeProject(1, { name: 'x' }), makeProject(2, { aliases: ['x'] })), /'x'/],
      ['an alias equal to another id', makeRegistry(makeProject(1), makeProject(2, { aliases: ['00000001'] })), /'00000001'/],
      ['a name equal to its own alias', makeRegistry(makeProject(1, { name: 'x', aliases: ['x'] })), /'x'/],
      ['duplicate ids', makeRegistry(makeProject(1), makeProject(2, { id: '00000001' })), /'00000001'/],
    ])('refuses %s', (_title, registry, message) => {
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(RegistryInvalidError);
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(message);
    });

    it('refuses an invalid name or id syntax', () => {
      expect(() => validateRegistry(makeRegistry(makeProject(1, { name: 'Bad Name' })), { checkPaths: false })).toThrow(/Bad Name/);
      expect(() => validateRegistry(makeRegistry(makeProject(1, { id: 'xyz' })), { checkPaths: false })).toThrow(/id 'xyz'/);
    });
  });

  describe('paths', () => {
    it('refuses a project with paths and no main', () => {
      const registry = makeRegistry(makeProject(1, { paths: [{ path: pathA, main: false }] }));
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(/exactly one main path.*has 0/s);
    });

    it('refuses two mains', () => {
      const registry = makeRegistry(
        makeProject(1, {
          paths: [
            { path: pathA, main: true },
            { path: pathB, main: true },
          ],
        }),
      );
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(/exactly one main path.*has 2/s);
    });

    it('refuses a path held by two projects, naming both', () => {
      const registry = makeRegistry(
        makeProject(1, { paths: [{ path: pathA, main: true }] }),
        makeProject(2, { paths: [{ path: pathA, main: true }] }),
      );
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(/p1.*p2/s);
    });

    it('compares paths with the platform key (case-insensitive on win32)', () => {
      const other = process.platform === 'win32' ? pathA.toUpperCase() : pathA;
      expect(pathKey(other)).toBe(pathKey(pathA));
      const registry = makeRegistry(
        makeProject(1, { paths: [{ path: pathA, main: true }] }),
        makeProject(2, { paths: [{ path: normalizePath(other), main: true }] }),
      );
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(RegistryInvalidError);
    });

    it('refuses a path that is not in normalized form', () => {
      const registry = makeRegistry(makeProject(1, { paths: [{ path: `${pathA}/`, main: true }] }));
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(/not normalized/);
    });

    it('checks that paths exist when checkPaths is true', () => {
      const missing = normalizePath(join(dir, 'missing'));
      const registry = makeRegistry(makeProject(1, { paths: [{ path: missing, main: true }] }));
      expect(() => validateRegistry(registry, { checkPaths: true })).toThrow(InvalidPathError);
      expect(() => validateRegistry(registry, { checkPaths: true })).toThrow(/p1/);
      expect(() => validateRegistry(registry, { checkPaths: false })).not.toThrow();
    });

    it('checks only the listed paths when checkPaths is an array of keys', () => {
      const missing = normalizePath(join(dir, 'missing'));
      const registry = makeRegistry(
        makeProject(1, { paths: [{ path: missing, main: true }] }),
        makeProject(2, { paths: [{ path: pathB, main: true }] }),
      );
      expect(() => validateRegistry(registry, { checkPaths: [pathKey(pathB)] })).not.toThrow();
      expect(() => validateRegistry(registry, { checkPaths: [pathKey(missing)] })).toThrow(InvalidPathError);
    });
  });

  describe('parents', () => {
    it('refuses a dangling parent', () => {
      expect(() => validateRegistry(makeRegistry(makeProject(1, { parent: 'deadbeef' })), { checkPaths: false })).toThrow(DanglingParentError);
    });

    it('refuses a cycle', () => {
      const registry = makeRegistry(makeProject(1, { parent: '00000002' }), makeProject(2, { parent: '00000001' }));
      expect(() => validateRegistry(registry, { checkPaths: false })).toThrow(ParentCycleError);
    });
  });
});

describe('validateRegistry without options', () => {
  it('does not touch the disk: registered paths are not checked by default', () => {
    const missing = makeRegistry(makeProject(1, { paths: [{ path: process.platform === 'win32' ? 'C:/definitely/missing' : '/definitely/missing', main: true }] }));
    expect(() => validateRegistry(missing)).not.toThrow();
    expect(() => validateRegistry(missing, { checkPaths: true })).toThrow(InvalidPathError);
  });
});
