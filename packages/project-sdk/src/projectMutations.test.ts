import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidLabelError,
  InvalidPathError,
  LabelTakenError,
  LockTimeoutError,
  ParentCycleError,
  PathOwnedError,
  ProjectNotFoundError,
  RegistryInvalidError,
} from './errors.js';
import { lockFilePath } from './lock.js';
import { addAlias, addProject, removeAlias, renameProject, setGit, setParent } from './projectMutations.js';
import { loadRegistry, registryFilePath } from './registryIo.js';
import { type Workspace, makeProject, makeRegistry, makeWorkspace } from './testHelpers.js';

describe('project mutations', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  describe('addProject', () => {
    it('creates the registry on first write and returns the project', async () => {
      const project = await addProject(ws.registryDir, { name: 'Shop' });
      expect(project).toMatchObject({ name: 'shop', aliases: [], paths: [] });
      expect(project.id).toMatch(/^[0-9a-f]{8}$/);
      expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
      expect(loadRegistry(ws.registryDir).projects).toEqual([project]);
      expect(existsSync(lockFilePath(ws.registryDir))).toBe(false);
    });

    it('lowercases aliases, keeps git as given and resolves the parent reference to its id', async () => {
      const parent = await addProject(ws.registryDir, { name: 'shared' });
      const child = await addProject(ws.registryDir, { name: 'shop', aliases: ['SH', 'Store'], git: 'git@example.com:x/y.git', parent: 'shared' });
      expect(child.aliases).toEqual(['sh', 'store']);
      expect(child.git).toBe('git@example.com:x/y.git');
      expect(child.parent).toBe(parent.id);
    });

    it('registers the given path as main, normalized', async () => {
      const path = ws.dir('shop');
      const project = await addProject(ws.registryDir, { name: 'shop', path: `${path}/` });
      expect(project.paths).toEqual([{ path, main: true }]);
    });

    it('refuses a missing path and writes nothing', async () => {
      await expect(addProject(ws.registryDir, { name: 'shop', path: `${ws.dir('x')}/missing` })).rejects.toBeInstanceOf(InvalidPathError);
      expect(existsSync(registryFilePath(ws.registryDir))).toBe(false);
    });

    it('refuses a path held by another project, naming the owner', async () => {
      const path = ws.dir('shop');
      await addProject(ws.registryDir, { name: 'shop', path });
      const error = await addProject(ws.registryDir, { name: 'other', path }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PathOwnedError);
      expect((error as Error).message).toMatch(/shop \([0-9a-f]{8}\)/);
      expect(loadRegistry(ws.registryDir).projects).toHaveLength(1);
    });

    it('refuses an invalid name, showing the rule', async () => {
      await expect(addProject(ws.registryDir, { name: '1bad' })).rejects.toBeInstanceOf(InvalidLabelError);
    });

    it.each([
      ['an existing name', { name: 'shop' }],
      ['an existing alias used as name', { name: 'sh' }],
      ['an existing alias used as alias', { name: 'other', aliases: ['sh'] }],
      ['its own alias', { name: 'other', aliases: ['other'] }],
      ['a repeated alias', { name: 'other', aliases: ['x', 'X'] }],
    ])('refuses a label equal to %s', async (_title, input) => {
      await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'] });
      await expect(addProject(ws.registryDir, input)).rejects.toBeInstanceOf(LabelTakenError);
      expect(loadRegistry(ws.registryDir).projects).toHaveLength(1);
    });

    it('refuses a name equal to an existing id', async () => {
      const first = await addProject(ws.registryDir, { name: 'shop' });
      await expect(addProject(ws.registryDir, { name: 'other', aliases: [first.id] })).rejects.toBeInstanceOf(InvalidLabelError);
    });

    it('refuses an unknown parent', async () => {
      await expect(addProject(ws.registryDir, { name: 'shop', parent: 'ghost' })).rejects.toBeInstanceOf(ProjectNotFoundError);
    });

    it('fails with LockTimeoutError while another writer holds the lock, leaving the registry untouched', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      const before = readFileSync(registryFilePath(ws.registryDir), 'utf8');
      writeFileSync(lockFilePath(ws.registryDir), JSON.stringify({ pid: 424242, token: 'foreign', host: 'h', createdAt: 'x' }));
      await expect(addProject(ws.registryDir, { name: 'other' }, { lock: { timeoutMs: 150, retryMs: 20 } })).rejects.toBeInstanceOf(LockTimeoutError);
      expect(readFileSync(registryFilePath(ws.registryDir), 'utf8')).toBe(before);
    });
  });

  describe('validation on write', () => {
    it('refuses to write over a registry that is already inconsistent, naming the entry', async () => {
      const dup = makeRegistry(makeProject(1, { name: 'same' }), makeProject(2, { name: 'same' }));
      await addProject(ws.registryDir, { name: 'seed' });
      writeFileSync(registryFilePath(ws.registryDir), JSON.stringify(dup));
      const error = await addProject(ws.registryDir, { name: 'other' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RegistryInvalidError);
      expect((error as Error).message).toContain('same');
      expect(loadRegistry(ws.registryDir).projects).toHaveLength(2);
    });
  });

  describe('renameProject', () => {
    it('renames, frees the old name and resolves the reference by alias or id prefix', async () => {
      const shop = await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'] });
      const renamed = await renameProject(ws.registryDir, 'sh', 'Store');
      expect(renamed.id).toBe(shop.id);
      expect(renamed.name).toBe('store');
      await expect(addProject(ws.registryDir, { name: 'shop' })).resolves.toBeDefined();
      const byPrefix = await renameProject(ws.registryDir, shop.id.slice(0, 5), 'market');
      expect(byPrefix.name).toBe('market');
    });

    it('refuses a taken or invalid name', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      await addProject(ws.registryDir, { name: 'blog' });
      await expect(renameProject(ws.registryDir, 'blog', 'shop')).rejects.toBeInstanceOf(LabelTakenError);
      await expect(renameProject(ws.registryDir, 'blog', 'Bad Name')).rejects.toBeInstanceOf(InvalidLabelError);
    });

    it('fails on an unknown project with a suggestion', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      await expect(renameProject(ws.registryDir, 'shpo', 'x')).rejects.toThrow(/did you mean/);
    });
  });

  describe('aliases', () => {
    it('adds and removes an alias', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      expect((await addAlias(ws.registryDir, 'shop', 'SH')).aliases).toEqual(['sh']);
      expect((await removeAlias(ws.registryDir, 'sh', 'sh')).aliases).toEqual([]);
    });

    it('refuses an alias already used elsewhere, or equal to the own name', async () => {
      await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'] });
      await addProject(ws.registryDir, { name: 'blog' });
      await expect(addAlias(ws.registryDir, 'blog', 'sh')).rejects.toBeInstanceOf(LabelTakenError);
      await expect(addAlias(ws.registryDir, 'blog', 'blog')).rejects.toBeInstanceOf(LabelTakenError);
    });

    it('fails loudly when removing an alias the project does not have, listing its aliases', async () => {
      await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'] });
      await expect(removeAlias(ws.registryDir, 'shop', 'nope')).rejects.toThrow(/no alias 'nope'.*sh/s);
    });
  });

  describe('setParent', () => {
    it('sets and clears the parent', async () => {
      const root = await addProject(ws.registryDir, { name: 'root' });
      await addProject(ws.registryDir, { name: 'leaf' });
      expect((await setParent(ws.registryDir, 'leaf', 'root')).parent).toBe(root.id);
      const cleared = await setParent(ws.registryDir, 'leaf', null);
      expect(cleared.parent).toBeUndefined();
      expect('parent' in cleared).toBe(false);
    });

    it('refuses cycles, including self', async () => {
      await addProject(ws.registryDir, { name: 'a' });
      await addProject(ws.registryDir, { name: 'b', parent: 'a' });
      await expect(setParent(ws.registryDir, 'a', 'b')).rejects.toBeInstanceOf(ParentCycleError);
      await expect(setParent(ws.registryDir, 'a', 'a')).rejects.toBeInstanceOf(ParentCycleError);
      expect(loadRegistry(ws.registryDir).projects.find((p) => p.name === 'a')?.parent).toBeUndefined();
    });

    it('refuses an unknown parent', async () => {
      await addProject(ws.registryDir, { name: 'a' });
      await expect(setParent(ws.registryDir, 'a', 'ghost')).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });

  describe('setGit', () => {
    it('sets a free string and clears it with null', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      expect((await setGit(ws.registryDir, 'shop', 'anything goes')).git).toBe('anything goes');
      const cleared = await setGit(ws.registryDir, 'shop', null);
      expect('git' in cleared).toBe(false);
    });
  });
});
