import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathOwnedError, RegistryInvalidError } from './errors.js';
import { addPath } from './pathMutations.js';
import { normalizePath, pathKey } from './paths.js';
import { addProject } from './projectMutations.js';
import { realPathKey } from './realPath.js';
import { findProjectForPath, resolveScope } from './resolution.js';
import { type Workspace, makeProject, makeRegistry, makeWorkspace } from './testHelpers.js';
import { validateRegistry } from './validate.js';

const isWin = process.platform === 'win32';

describe('folders reached through a link', () => {
  let ws: Workspace;
  let real: string;
  let link: string;

  beforeEach(() => {
    ws = makeWorkspace();
    real = ws.dir('real-shop');
    ws.dir('real-shop/src/deep');
    // A directory junction on Windows (no admin needed), a symlink elsewhere: the folder is the same, the path is not.
    link = join(ws.dir('links'), 'shop-link');
    symlinkSync(real, link, isWin ? 'junction' : 'dir');
  });

  afterEach(() => {
    ws.cleanup();
  });

  const shop = (path: string) => makeProject(1, { name: 'shop', paths: [{ path, main: true }] });

  describe('realPathKey', () => {
    it('is the key of the real folder behind a link', () => {
      expect(realPathKey(link)).toBe(pathKey(realpathSync.native(real)));
      expect(realPathKey(link)).toBe(realPathKey(real));
    });

    it('is undefined for a folder that does not exist, and never throws', () => {
      expect(realPathKey(join(real, 'missing'))).toBeUndefined();
    });
  });

  describe('findProjectForPath', () => {
    it('matches a cwd inside the link when the project is registered by its real path', () => {
      const registry = makeRegistry(shop(real));
      const match = findProjectForPath(registry, normalizePath(join(link, 'src', 'deep')));
      expect(match).toEqual({ project: registry.projects[0], path: real, main: true });
    });

    it('matches a cwd inside the real folder when the project is registered through the link', () => {
      const registry = makeRegistry(shop(normalizePath(link)));
      expect(findProjectForPath(registry, normalizePath(join(real, 'src')))?.project.name).toBe('shop');
    });

    it('still prefers the deepest registered path', () => {
      const nested = makeProject(2, { name: 'nested', paths: [{ path: normalizePath(join(real, 'src')), main: true }] });
      const registry = makeRegistry(shop(real), nested);
      expect(findProjectForPath(registry, normalizePath(join(link, 'src', 'deep')))?.project.name).toBe('nested');
    });

    it('keeps matching by the normalized key when a registered path no longer exists', () => {
      const gone = normalizePath(join(ws.dir('gone-parent'), 'gone'));
      const registry = makeRegistry(shop(gone), makeProject(2, { name: 'other', paths: [{ path: real, main: true }] }));
      expect(findProjectForPath(registry, join(gone, 'sub'))?.project.name).toBe('shop');
      expect(findProjectForPath(registry, normalizePath(join(link, 'src')))?.project.name).toBe('other');
    });

    it('does not match an unrelated folder', () => {
      const registry = makeRegistry(shop(real));
      expect(findProjectForPath(registry, ws.dir('elsewhere'))).toBeUndefined();
    });
  });

  describe('resolveScope', () => {
    it('reports the registered path as the working directory, found from the cwd', () => {
      const registry = makeRegistry(shop(real));
      const scope = resolveScope(registry, { cwd: join(link, 'src') });
      expect(scope).toMatchObject({ source: 'cwd', path: real, pathVia: 'cwd' });
    });

    it('also uses the link-aware match to pick the path of a project resolved by --project', () => {
      const project = makeProject(1, {
        name: 'shop',
        paths: [
          { path: ws.dir('main'), main: true },
          { path: real, main: false },
        ],
      });
      const scope = resolveScope(makeRegistry(project), { flag: 'shop', cwd: join(link, 'src') });
      expect(scope).toMatchObject({ source: 'flag', path: real, pathVia: 'cwd' });
    });
  });

  describe('path ownership', () => {
    it('refuses to register a link to a folder that another project already owns', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: real });
      await expect(addProject(ws.registryDir, { name: 'other', path: link })).rejects.toBeInstanceOf(PathOwnedError);
      await addProject(ws.registryDir, { name: 'third' });
      await expect(addPath(ws.registryDir, 'third', join(link, 'src', '..'))).rejects.toThrow(/already registered by project shop/);
    });

    it('is refused by the write validation too, only for the paths being added or moved', () => {
      const registry = makeRegistry(shop(real), makeProject(2, { name: 'other', paths: [{ path: normalizePath(link), main: true }] }));
      expect(() => validateRegistry(registry, { checkPaths: [pathKey(link)] })).toThrow(RegistryInvalidError);
      expect(() => validateRegistry(registry, { checkPaths: [pathKey(link)] })).toThrow(/shop.*other.*same folder/s);
      expect(() => validateRegistry(registry)).not.toThrow();
    });
  });

  describe.runIf(isWin)('8.3 short names (win32)', () => {
    it('resolves a cwd given by its short name', () => {
      const long = ws.dir('a-folder-with-a-long-name');
      const script = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${long}').ShortPath`;
      const short = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
      // A volume with 8.3 generation disabled returns the long name: say so instead of passing without testing anything.
      expect(normalizePath(short), '8.3 short names are disabled on this volume, this test cannot run here').not.toBe(long);
      const registry = makeRegistry(shop(long));
      expect(findProjectForPath(registry, normalizePath(short))?.project.name).toBe('shop');
    });
  });
});
