import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidPathError, MainPathError, NoProjectInScopeError, PathOwnedError, RegistryInvalidError } from './errors.js';
import { addPath, removePath } from './pathMutations.js';
import { assertDirectory, normalizePath, toNativePath } from './paths.js';
import { addProject } from './projectMutations.js';
import { resolveScope } from './resolution.js';
import { type Workspace, makeProject, makeRegistry, makeWorkspace } from './testHelpers.js';
import { validateRegistry } from './validate.js';

const isWin = process.platform === 'win32';

// Paths are stored with forward slashes; the messages show them the way the platform writes them, and the error data stays as stored.
describe('paths in messages are in the native form, the data of the errors is as stored', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });
  afterEach(() => ws.cleanup());

  it('NoProjectInScopeError: the message and the hint show the cwd natively, cwd stays stored', () => {
    const cwd = ws.dir('somewhere');
    const error = (() => {
      try {
        resolveScope(makeRegistry(), { cwd });
      } catch (e) {
        return e as NoProjectInScopeError;
      }
      throw new Error('expected an error');
    })();
    expect(error.message).toBe(`no project in scope for ${toNativePath(cwd)}. Registered: none`);
    expect(error.hint).toBe(`pass a project reference, or register this folder with: project add "${toNativePath(cwd)}"`);
    expect(error.cwd).toBe(cwd);
  });

  it.runIf(isWin)('NoProjectInScopeError on win32: project add "C:\\...", no forward slash in the hint', () => {
    const error = (() => {
      try {
        resolveScope(makeRegistry(), { cwd: 'C:/Users/me/work/shop' });
      } catch (e) {
        return e as NoProjectInScopeError;
      }
      throw new Error('expected an error');
    })();
    expect(error.hint).toContain('project add "C:\\Users\\me\\work\\shop"');
    expect(error.hint).not.toContain('/');
  });

  it('PathOwnedError: the path the user typed is shown natively', async () => {
    const shop = ws.dir('shop');
    await addProject(ws.registryDir, { name: 'shop', path: shop });
    const error = (await addProject(ws.registryDir, { name: 'other', path: shop }).catch((e: unknown) => e)) as PathOwnedError;
    expect(error).toBeInstanceOf(PathOwnedError);
    expect(error.message).toContain(`path ${toNativePath(shop)} is already registered by project shop`);
  });

  it('InvalidPathError: the path is shown natively in the message, as stored in the data', () => {
    const missing = `${ws.dir('here')}/missing`;
    const error = (() => {
      try {
        assertDirectory(normalizePath(missing));
      } catch (e) {
        return e as InvalidPathError;
      }
      throw new Error('expected an error');
    })();
    expect(error.message).toContain(`path ${toNativePath(normalizePath(missing))} does not exist`);
    expect(error.path).toBe(normalizePath(missing));
  });

  it('a registered path and the path the user typed use the same form in the same message', async () => {
    const a = ws.dir('a');
    const b = ws.dir('b');
    const other = ws.dir('other');
    await addProject(ws.registryDir, { name: 'shop', path: a });
    await addPath(ws.registryDir, 'shop', b);
    const notOwned = (await removePath(ws.registryDir, 'shop', other).catch((e: unknown) => e)) as InvalidPathError;
    expect(notOwned.message).toContain(`does not have path ${toNativePath(other)} (registered paths: ${toNativePath(a)}, ${toNativePath(b)})`);
    const main = (await removePath(ws.registryDir, 'shop', a).catch((e: unknown) => e)) as MainPathError;
    expect(main).toBeInstanceOf(MainPathError);
    expect(main.message).toContain(`${toNativePath(a)} is the main path`);
    expect(main.message).toContain(`other paths exist (${toNativePath(b)})`);
  });

  it('the write validation shows a path held by two projects natively', () => {
    const x = ws.dir('x');
    const registry = makeRegistry(makeProject(1, { name: 'one', paths: [{ path: x, main: true }] }), makeProject(2, { name: 'two', paths: [{ path: x, main: true }] }));
    expect(() => validateRegistry(registry)).toThrow(RegistryInvalidError);
    expect(() => validateRegistry(registry)).toThrow(`path '${toNativePath(x)}' is registered by`);
  });
});
