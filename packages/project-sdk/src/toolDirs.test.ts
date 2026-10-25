import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DanglingParentError, InvalidIdError, InvalidToolError } from './errors.js';
import { makeProject, makeRegistry } from './testHelpers.js';
import { defaultRegistryDir } from './registryDir.js';
import { getConfigLayers, projectDir, projectToolDir } from './toolDirs.js';

describe('defaultRegistryDir', () => {
  it('uses $XDG_CONFIG_HOME/project when set', () => {
    expect(defaultRegistryDir({ XDG_CONFIG_HOME: join('x', 'cfg') }, join('h', 'home'))).toBe(join('x', 'cfg', 'project'));
  });

  it('falls back to <home>/.config/project when unset or empty', () => {
    expect(defaultRegistryDir({}, join('h', 'home'))).toBe(join('h', 'home', '.config', 'project'));
    expect(defaultRegistryDir({ XDG_CONFIG_HOME: '' }, join('h', 'home'))).toBe(join('h', 'home', '.config', 'project'));
    expect(defaultRegistryDir({ XDG_CONFIG_HOME: '   ' }, join('h', 'home'))).toBe(join('h', 'home', '.config', 'project'));
  });
});

describe('projectToolDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-sdk-tooldir-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds <registryDir>/projects/<id>/<tool>/<kind> without creating it by default', () => {
    const result = projectToolDir(dir, '3fa9c1d2', 'task', 'config');
    expect(result).toBe(join(dir, 'projects', '3fa9c1d2', 'task', 'config'));
    expect(existsSync(result)).toBe(false);
  });

  it('creates the directory (recursively) only when ensure is true', () => {
    const result = projectToolDir(dir, '3fa9c1d2', 'flow', 'data', { ensure: true });
    expect(result).toBe(join(dir, 'projects', '3fa9c1d2', 'flow', 'data'));
    expect(existsSync(result)).toBe(true);
    expect(() => projectToolDir(dir, '3fa9c1d2', 'flow', 'data', { ensure: true })).not.toThrow();
  });

  it.each(['', 'Task', '1task', 'a/b', '..', 'a b', 'a_b'])('refuses the tool name %j', (tool) => {
    expect(() => projectToolDir(dir, '3fa9c1d2', tool, 'config')).toThrow(InvalidToolError);
  });

  it('accepts dashes and digits in tool names', () => {
    expect(() => projectToolDir(dir, '3fa9c1d2', 'queue-2', 'config')).not.toThrow();
  });

  it.each(['shop', '../x', '3FA9C1D2', '3fa9c1d', '3fa9c1d22', ''])('refuses %j as a project id (never builds a path from a name)', (id) => {
    expect(() => projectToolDir(dir, id, 'task', 'config')).toThrow(InvalidIdError);
  });

  it('refuses an unknown kind', () => {
    expect(() => projectToolDir(dir, '3fa9c1d2', 'task', 'bogus' as 'config')).toThrow(/'config', 'data', 'cache' or 'logs'/);
  });
});

describe('getConfigLayers', () => {
  it('returns the config dirs root-first, without any I/O', () => {
    const root = makeProject(1);
    const leaf = makeProject(2, { parent: root.id });
    const layers = getConfigLayers(makeRegistry(leaf, root), '/reg', leaf, 'task');
    expect(layers).toEqual([
      { project: root, dir: join('/reg', 'projects', '00000001', 'task', 'config') },
      { project: leaf, dir: join('/reg', 'projects', '00000002', 'task', 'config') },
    ]);
  });

  it('returns a single layer for a project without parent', () => {
    const only = makeProject(1);
    expect(getConfigLayers(makeRegistry(only), '/reg', only, 'queue')).toHaveLength(1);
  });

  it('fails on a dangling parent', () => {
    const orphan = makeProject(1, { parent: 'deadbeef' });
    expect(() => getConfigLayers(makeRegistry(orphan), '/reg', orphan, 'task')).toThrow(DanglingParentError);
  });
});

describe('defaultRegistryDir without a home argument', () => {
  it('defaults the home to the home directory of the user', () => {
    expect(defaultRegistryDir({})).toBe(join(homedir(), '.config', 'project'));
  });

  it('still prefers $XDG_CONFIG_HOME', () => {
    expect(defaultRegistryDir({ XDG_CONFIG_HOME: join('x', 'cfg') })).toBe(join('x', 'cfg', 'project'));
  });
});

describe('projectDir', () => {
  it('is <registryDir>/projects/<id>, the parent of every tool folder', () => {
    expect(projectDir(join('reg'), '3fa9c1d2')).toBe(join('reg', 'projects', '3fa9c1d2'));
    expect(projectToolDir(join('reg'), '3fa9c1d2', 'task', 'data')).toBe(join(projectDir('reg', '3fa9c1d2'), 'task', 'data'));
  });

  it('refuses anything that is not a project id', () => {
    expect(() => projectDir('reg', '../escape')).toThrow(InvalidIdError);
  });
});

describe('projectToolDir kinds', () => {
  it.each(['config', 'data', 'cache', 'logs'] as const)('has the layout <registryDir>/projects/<id>/<tool>/%s', (kind) => {
    expect(projectToolDir('reg', '3fa9c1d2', 'task', kind)).toBe(join('reg', 'projects', '3fa9c1d2', 'task', kind));
  });

  it('creates the cache and logs folders with ensure', () => {
    const root = mkdtempSync(join(tmpdir(), 'project-sdk-kinds-'));
    try {
      expect(existsSync(projectToolDir(root, '3fa9c1d2', 'flow', 'cache', { ensure: true }))).toBe(true);
      expect(existsSync(projectToolDir(root, '3fa9c1d2', 'flow', 'logs', { ensure: true }))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
