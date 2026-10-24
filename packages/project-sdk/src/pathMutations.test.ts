import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidPathError, MainPathError, PathOwnedError } from './errors.js';
import { addPath, movePath, removePath, setMain } from './pathMutations.js';
import { addProject } from './projectMutations.js';
import { loadRegistry } from './registryIo.js';
import { type Workspace, makeWorkspace } from './testHelpers.js';

describe('path mutations', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  function stored(name: string) {
    return loadRegistry(ws.registryDir).projects.find((p) => p.name === name)!;
  }

  describe('addPath', () => {
    it('makes the first path of a virtual project its main path, even without the main flag', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      const project = await addPath(ws.registryDir, 'shop', ws.dir('a'), { main: false });
      expect(project.paths).toEqual([{ path: ws.dir('a'), main: true }]);
    });

    it('adds further paths as non-main, or as main when asked (the previous main is demoted)', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await addPath(ws.registryDir, 'shop', ws.dir('b'));
      expect(stored('shop').paths).toEqual([
        { path: ws.dir('a'), main: true },
        { path: ws.dir('b'), main: false },
      ]);
      await addPath(ws.registryDir, 'shop', ws.dir('c'), { main: true });
      expect(stored('shop').paths.filter((p) => p.main).map((p) => p.path)).toEqual([ws.dir('c')]);
    });

    it('refuses a path held by another project, naming the owner', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await addProject(ws.registryDir, { name: 'blog' });
      const error = await addPath(ws.registryDir, 'blog', ws.dir('a')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PathOwnedError);
      expect((error as Error).message).toMatch(/shop \([0-9a-f]{8}\)/);
      expect(stored('blog').paths).toEqual([]);
    });

    it('refuses a path the project already has', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await expect(addPath(ws.registryDir, 'shop', ws.dir('a'))).rejects.toBeInstanceOf(PathOwnedError);
    });

    it.runIf(process.platform === 'win32')('refuses a path held by another project under a different letter case (win32)', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('Case') });
      await addProject(ws.registryDir, { name: 'blog' });
      await expect(addPath(ws.registryDir, 'blog', ws.dir('Case').toUpperCase())).rejects.toBeInstanceOf(PathOwnedError);
    });

    it('refuses a missing path and a file', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      await expect(addPath(ws.registryDir, 'shop', join(ws.dir('a'), 'missing'))).rejects.toBeInstanceOf(InvalidPathError);
      writeFileSync(join(ws.dir('a'), 'f.txt'), 'x');
      await expect(addPath(ws.registryDir, 'shop', join(ws.dir('a'), 'f.txt'))).rejects.toThrow(/not a directory/);
      expect(stored('shop').paths).toEqual([]);
    });
  });

  describe('removePath', () => {
    async function twoPaths(): Promise<void> {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await addPath(ws.registryDir, 'shop', ws.dir('b'));
    }

    it('removes a non-main path', async () => {
      await twoPaths();
      const project = await removePath(ws.registryDir, 'shop', ws.dir('b'));
      expect(project.paths).toEqual([{ path: ws.dir('a'), main: true }]);
    });

    it('refuses to remove the main path while others exist, unless a new main is named', async () => {
      await twoPaths();
      const error = await removePath(ws.registryDir, 'shop', ws.dir('a')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MainPathError);
      expect((error as Error).message).toMatch(/newMain|new main/);
      expect(stored('shop').paths).toHaveLength(2);
      const project = await removePath(ws.registryDir, 'shop', ws.dir('a'), { newMain: ws.dir('b') });
      expect(project.paths).toEqual([{ path: ws.dir('b'), main: true }]);
    });

    it('refuses a newMain that is not a path of the project', async () => {
      await twoPaths();
      await expect(removePath(ws.registryDir, 'shop', ws.dir('a'), { newMain: ws.dir('elsewhere') })).rejects.toBeInstanceOf(InvalidPathError);
    });

    it('lets the last path go: the project becomes virtual', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      expect((await removePath(ws.registryDir, 'shop', ws.dir('a'))).paths).toEqual([]);
    });

    it('can remove a path whose folder no longer exists', async () => {
      await twoPaths();
      const gone = ws.dir('b');
      rmSync(gone, { recursive: true });
      expect((await removePath(ws.registryDir, 'shop', gone)).paths).toHaveLength(1);
    });

    it('fails when the path is not registered for the project, listing its paths', async () => {
      await twoPaths();
      await expect(removePath(ws.registryDir, 'shop', ws.dir('zzz'))).rejects.toThrow(/does not have path.*registered paths/s);
    });
  });

  describe('movePath', () => {
    it('replaces the path, keeping the project id and the main flag', async () => {
      const created = await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await addPath(ws.registryDir, 'shop', ws.dir('b'));
      const moved = await movePath(ws.registryDir, 'shop', ws.dir('a'), ws.dir('c'));
      expect(moved.id).toBe(created.id);
      expect(moved.paths).toEqual([
        { path: ws.dir('c'), main: true },
        { path: ws.dir('b'), main: false },
      ]);
    });

    it('works when the old folder is gone and another registered path is also missing', async () => {
      const goneA = ws.dir('a');
      const goneX = ws.dir('x');
      await addProject(ws.registryDir, { name: 'shop', path: goneA });
      await addProject(ws.registryDir, { name: 'blog', path: goneX });
      rmSync(goneA, { recursive: true });
      rmSync(goneX, { recursive: true });
      const moved = await movePath(ws.registryDir, 'shop', goneA, ws.dir('c'));
      expect(moved.paths).toEqual([{ path: ws.dir('c'), main: true }]);
    });

    it('refuses a target held by another project', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await addProject(ws.registryDir, { name: 'blog', path: ws.dir('b') });
      await expect(movePath(ws.registryDir, 'shop', ws.dir('a'), ws.dir('b'))).rejects.toBeInstanceOf(PathOwnedError);
    });

    it('refuses a missing target and an unregistered source', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await expect(movePath(ws.registryDir, 'shop', ws.dir('a'), join(ws.dir('b'), 'missing'))).rejects.toBeInstanceOf(InvalidPathError);
      await expect(movePath(ws.registryDir, 'shop', ws.dir('zzz'), ws.dir('b'))).rejects.toBeInstanceOf(InvalidPathError);
      expect(stored('shop').paths).toEqual([{ path: ws.dir('a'), main: true }]);
    });

    it.runIf(process.platform === 'win32')('accepts a change of letter case of its own path (win32)', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('Case') });
      const moved = await movePath(ws.registryDir, 'shop', ws.dir('Case'), ws.dir('Case').toUpperCase());
      expect(moved.paths).toHaveLength(1);
    });
  });

  describe('setMain', () => {
    it('moves the main flag to another path of the project', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await addPath(ws.registryDir, 'shop', ws.dir('b'));
      const project = await setMain(ws.registryDir, 'shop', ws.dir('b'));
      expect(project.paths).toEqual([
        { path: ws.dir('a'), main: false },
        { path: ws.dir('b'), main: true },
      ]);
    });

    it('refuses a path that is not registered for the project', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await expect(setMain(ws.registryDir, 'shop', ws.dir('zzz'))).rejects.toBeInstanceOf(InvalidPathError);
    });
  });
});
