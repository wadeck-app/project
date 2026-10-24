import { describe, expect, it } from 'vitest';
import { AmbiguousReferenceError, NoProjectInScopeError, ProjectNotFoundError, VirtualProjectError } from './errors.js';
import { describeResolution, findProjectForPath, requirePath, resolveScope } from './resolution.js';
import { toNativePath } from './paths.js';
import { makeProject, makeRegistry } from './testHelpers.js';

const isWin = process.platform === 'win32';
const base = isWin ? 'C:/work' : '/work';

const shop = makeProject(1, {
  name: 'shop',
  paths: [
    { path: `${base}/shop`, main: true },
    { path: `${base}/shop-x`, main: false },
  ],
});
const nested = makeProject(2, { name: 'nested', paths: [{ path: `${base}/shop/packages/nested`, main: true }] });
const virtual = makeProject(3, { name: 'shared' });
const registry = makeRegistry(shop, nested, virtual);

describe('findProjectForPath', () => {
  it('matches the path itself and any descendant', () => {
    expect(findProjectForPath(registry, `${base}/shop`)).toEqual({ project: shop, path: `${base}/shop`, main: true });
    expect(findProjectForPath(registry, `${base}/shop/src/deep`)?.project).toBe(shop);
  });

  it('reports a non-main path as not main', () => {
    expect(findProjectForPath(registry, `${base}/shop-x/sub`)).toEqual({ project: shop, path: `${base}/shop-x`, main: false });
  });

  it('prefers the deepest registered path', () => {
    expect(findProjectForPath(registry, `${base}/shop/packages/nested/src`)?.project).toBe(nested);
    expect(findProjectForPath(registry, `${base}/shop/packages`)?.project).toBe(shop);
  });

  it('respects segment boundaries', () => {
    expect(findProjectForPath(registry, `${base}/shopping`)).toBeUndefined();
    expect(findProjectForPath(registry, `${base}/sho`)).toBeUndefined();
  });

  it('returns undefined outside every project and for an empty registry', () => {
    expect(findProjectForPath(registry, `${base}/blog`)).toBeUndefined();
    expect(findProjectForPath(makeRegistry(), base)).toBeUndefined();
  });

  it('never touches the disk: registered paths that do not exist are fine', () => {
    expect(() => findProjectForPath(registry, `${base}/shop/x`)).not.toThrow();
  });

  it.runIf(isWin)('is case-insensitive and accepts backslashes (win32)', () => {
    expect(findProjectForPath(registry, 'c:\\WORK\\Shop\\src')?.project).toBe(shop);
  });

  it.runIf(!isWin)('is case-sensitive (posix)', () => {
    expect(findProjectForPath(registry, `${base}/SHOP`)).toBeUndefined();
  });
});

describe('resolveScope', () => {
  it('resolves from the cwd', () => {
    const scope = resolveScope(registry, { cwd: `${base}/shop-x/src` });
    expect(scope).toMatchObject({ project: shop, path: `${base}/shop-x`, source: 'cwd', via: 'cwd', pathVia: 'cwd' });
  });

  it('prefers the flag over the env, and the env over the cwd', () => {
    expect(resolveScope(registry, { flag: 'shop', env: 'nested', cwd: `${base}/elsewhere` })).toMatchObject({ project: shop, source: 'flag', via: '--project' });
    expect(resolveScope(registry, { env: 'nested', cwd: `${base}/shop` })).toMatchObject({ project: nested, source: 'env' });
  });

  it('names the environment variable when given', () => {
    expect(resolveScope(registry, { env: 'shop', envName: 'TASK_PROJECT', cwd: base }).via).toBe('TASK_PROJECT');
  });

  it('treats a blank environment value as unset', () => {
    expect(resolveScope(registry, { env: '  ', cwd: `${base}/shop` }).source).toBe('cwd');
  });

  it('uses the main path when the flag points to a project from outside it', () => {
    expect(resolveScope(registry, { flag: 'shop', cwd: `${base}/elsewhere` })).toMatchObject({ path: `${base}/shop`, pathVia: 'main' });
  });

  it('uses the path containing the cwd when it is a non-main path of the project', () => {
    expect(resolveScope(registry, { flag: 'shop', cwd: `${base}/shop-x/sub` })).toMatchObject({ path: `${base}/shop-x`, pathVia: 'cwd' });
  });

  it('has no path for a virtual project', () => {
    const scope = resolveScope(registry, { flag: 'shared', cwd: `${base}/shop` });
    expect(scope.path).toBeUndefined();
    expect(scope.pathVia).toBeUndefined();
  });

  it('does not let the cwd of another project leak into the path of the flagged project', () => {
    expect(resolveScope(registry, { flag: 'shop', cwd: `${base}/shop/packages/nested` })).toMatchObject({ project: shop, path: `${base}/shop` });
  });

  it('propagates not found and ambiguity from the reference', () => {
    expect(() => resolveScope(registry, { flag: 'shpo', cwd: base })).toThrow(ProjectNotFoundError);
    const ambiguous = makeRegistry(makeProject(0xabcd0001), makeProject(0xabcd0002));
    expect(() => resolveScope(ambiguous, { flag: 'abcd', cwd: base })).toThrow(AmbiguousReferenceError);
  });

  it('does not fall back to the cwd when the flag does not resolve', () => {
    expect(() => resolveScope(registry, { flag: 'ghost', cwd: `${base}/shop` })).toThrow(ProjectNotFoundError);
  });

  it('fails with an actionable error when nothing resolves', () => {
    const error = (() => {
      try {
        resolveScope(registry, { cwd: `${base}/blog` });
      } catch (e) {
        return e as Error;
      }
      throw new Error('expected NoProjectInScopeError');
    })();
    expect(error).toBeInstanceOf(NoProjectInScopeError);
    expect(error.message).toBe(
      `no project in scope for ${toNativePath(`${base}/blog`)}. Registered: shop, nested, shared`,
    );
  });

  it('caps the registered list at 10 names, and handles an empty registry', () => {
    const many = makeRegistry(...Array.from({ length: 12 }, (_, i) => makeProject(i + 1, { name: `n${i + 1}` })));
    expect(() => resolveScope(many, { cwd: base })).toThrow(/Registered: n1, n2, n3, n4, n5, n6, n7, n8, n9, n10, \.\.\. \(2 more\)$/);
    expect(() => resolveScope(makeRegistry(), { cwd: base })).toThrow(/Registered: none$/);
  });
});

describe('describeResolution', () => {
  it('describes a flag-resolved project with its path source', () => {
    const scope = resolveScope(registry, { flag: 'shop', cwd: `${base}/shop-x` });
    expect(describeResolution(scope, { registryDir: '/reg' })).toBe(`project: shop (00000001) via --project, path ${base}/shop-x (cwd); registry: /reg`);
  });

  it('describes the main path and a virtual project', () => {
    expect(describeResolution(resolveScope(registry, { flag: 'shop', cwd: base }), { registryDir: '/reg' })).toBe(
      `project: shop (00000001) via --project, path ${base}/shop (main); registry: /reg`,
    );
    expect(describeResolution(resolveScope(registry, { flag: 'shared', cwd: base }), { registryDir: '/reg' })).toBe(
      'project: shared (00000003) via --project, path none (virtual project); registry: /reg',
    );
  });

  it('describes a cwd resolution', () => {
    expect(describeResolution(resolveScope(registry, { cwd: `${base}/shop` }), { registryDir: '/reg' })).toBe(
      `project: shop (00000001) via cwd, path ${base}/shop (cwd); registry: /reg`,
    );
  });
});

describe('requirePath', () => {
  it('returns the path', () => {
    expect(requirePath(resolveScope(registry, { cwd: `${base}/shop` }))).toBe(`${base}/shop`);
  });

  it('fails on a virtual project with the command to add a path', () => {
    const run = () => requirePath(resolveScope(registry, { flag: 'shared', cwd: base }));
    expect(run).toThrow(VirtualProjectError);
    expect(run).toThrow(/project shared has no path, this command needs a working directory; add a path to the project first/);
  });
});

describe('resolveScope with a label for the reference', () => {
  it('reports the label as the source of an explicit reference, still as a flag-like source', () => {
    const scope = resolveScope(registry, { flag: 'shop', label: '<ref> argument', cwd: `${base}/elsewhere` });
    expect(scope).toMatchObject({ source: 'flag', via: '<ref> argument', path: `${base}/shop`, pathVia: 'main' });
    expect(describeResolution(scope, { registryDir: '/reg' })).toContain('via <ref> argument,');
  });

  it('defaults to --project', () => {
    expect(resolveScope(registry, { flag: 'shop', cwd: base }).via).toBe('--project');
  });
});
