import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Project, loadDeleted, loadRegistry } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness, native } from '../testHelpers.js';

describe('mutating commands', () => {
  let h: Harness;
  let shop: string;

  beforeEach(async () => {
    h = makeHarness();
    shop = h.dir('shop');
    const result = await h.cli(['add', shop, '--alias', 'sh']);
    expect(result.err, 'setup: add shop').not.toContain('error:');
  });
  afterEach(() => h.cleanup());

  function project(ref: string): Project {
    const found = loadRegistry(h.registryDir).projects.find((p) => p.name === ref || p.aliases.includes(ref));
    if (found === undefined) {
      throw new Error(`test setup: no project '${ref}'`);
    }
    return found;
  }

  describe('rename', () => {
    it('renames the project, keeping its id, and logs the resolution first', async () => {
      const id = project('shop').id;
      const result = await h.cli(['rename', 'shop', 'store']);
      expect(result.code).toBe(0);
      expect(result.out).toBe(`renamed shop -> store (${id})`);
      expect(result.err).toContain('via <ref> argument');
      expect(project('store').id).toBe(id);
    });

    it('renames the project of the cwd when only the new name is given', async () => {
      const result = await h.cli(['rename', 'store'], { cwd: shop });
      expect(result.code).toBe(0);
      expect(project('store').paths[0]?.path).toBe(shop);
    });

    it('prints the project as JSON', async () => {
      const result = await h.cli(['rename', 'shop', 'store', '--json']);
      expect(JSON.parse(result.out)).toEqual(project('store'));
    });

    it('exits 1 when the name is taken, naming the owner', async () => {
      await h.cli(['add', h.dir('other')]);
      const result = await h.cli(['rename', 'shop', 'other']);
      expect(result.code).toBe(1);
      expect(result.err).toContain("already used by project other");
    });

    it('exits 2 when the arguments are missing', async () => {
      const result = await h.cli(['rename']);
      expect(result.code).toBe(2);
      expect(result.err).toContain('expected [<ref>] <new-name>, got none');
    });
  });

  describe('alias', () => {
    it('adds then removes an alias', async () => {
      const added = await h.cli(['alias', 'add', 'shop', 'store']);
      expect(added.out).toBe(`added alias 'store' to shop (${project('shop').id})`);
      expect(project('shop').aliases).toEqual(['sh', 'store']);
      const removed = await h.cli(['alias', 'remove', 'shop', 'sh']);
      expect(removed.out).toBe(`removed alias 'sh' from shop (${project('shop').id})`);
      expect(project('shop').aliases).toEqual(['store']);
    });

    it('exits 1 when removing an alias the project does not have, listing its aliases', async () => {
      const result = await h.cli(['alias', 'remove', 'shop', 'nope']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('its aliases: sh');
    });
  });

  describe('parent', () => {
    beforeEach(async () => {
      const result = await h.cli(['add', '--virtual', '--name', 'base']);
      expect(result.err, 'setup: add base').not.toContain('error:');
    });

    it('sets then clears the parent', async () => {
      const set = await h.cli(['parent', 'set', 'shop', 'base']);
      expect(set.out).toBe(`shop (${project('shop').id}) now inherits from base (${project('base').id})`);
      expect(project('shop').parent).toBe(project('base').id);
      const cleared = await h.cli(['parent', 'clear', 'shop']);
      expect(cleared.out).toBe(`shop (${project('shop').id}) has no parent anymore`);
      expect(project('shop').parent).toBeUndefined();
    });

    it('uses the project of the cwd when only the parent is given', async () => {
      await h.cli(['parent', 'set', 'base'], { cwd: shop });
      expect(project('shop').parent).toBe(project('base').id);
    });

    it('exits 1 on a cycle', async () => {
      await h.cli(['parent', 'set', 'shop', 'base']);
      const result = await h.cli(['parent', 'set', 'base', 'shop']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('parent cycle');
    });
  });

  describe('git', () => {
    it('sets then clears the git field', async () => {
      const set = await h.cli(['git', 'set', 'shop', 'git@x:shop.git']);
      expect(set.out).toBe(`git of shop (${project('shop').id}) is now git@x:shop.git`);
      expect(project('shop').git).toBe('git@x:shop.git');
      const cleared = await h.cli(['git', 'clear', 'shop']);
      expect(cleared.out).toBe(`git of shop (${project('shop').id}) was cleared`);
      expect(project('shop').git).toBeUndefined();
    });
  });

  describe('paths', () => {
    it('adds a secondary path, relative to the cwd, then makes it main', async () => {
      const wt = h.dir('wt');
      const added = await h.cli(['paths', 'add', 'shop', 'wt']);
      expect(added.code).toBe(0);
      expect(added.out.split('\n')).toEqual([`added path ${native(wt)} to shop (${project('shop').id})`, '  paths:', `    ${native(shop)} (main)`, `    ${native(wt)}`]);
      await h.cli(['paths', 'main', 'shop', wt]);
      expect(project('shop').paths).toEqual([
        { path: shop, main: false },
        { path: wt, main: true },
      ]);
    });

    it('adds a path as main with --main', async () => {
      const wt = h.dir('wt');
      await h.cli(['paths', 'add', 'shop', wt, '--main']);
      expect(project('shop').paths.find((p) => p.main)?.path).toBe(wt);
    });

    it('removes a secondary path', async () => {
      const wt = h.dir('wt');
      await h.cli(['paths', 'add', 'shop', wt]);
      const result = await h.cli(['paths', 'remove', 'shop', wt]);
      expect(result.code).toBe(0);
      expect(project('shop').paths).toEqual([{ path: shop, main: true }]);
    });

    it('refuses to remove the main path while others exist, unless --new-main names the next one', async () => {
      const wt = h.dir('wt');
      await h.cli(['paths', 'add', 'shop', wt]);
      const refused = await h.cli(['paths', 'remove', 'shop', shop]);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('main path');
      expect(refused.err).toContain('hint: pass --new-main <path>');
      const done = await h.cli(['paths', 'remove', 'shop', shop, '--new-main', wt]);
      expect(done.code).toBe(0);
      expect(project('shop').paths).toEqual([{ path: wt, main: true }]);
    });

    it('moves a path to a new folder, keeping the project', async () => {
      const moved = h.dir('moved');
      const id = project('shop').id;
      const result = await h.cli(['paths', 'move', 'shop', shop, moved]);
      expect(result.code).toBe(0);
      expect(project('shop')).toMatchObject({ id, paths: [{ path: moved, main: true }] });
    });

    it('exits 1 when the path is not one of the project, listing its paths', async () => {
      const result = await h.cli(['paths', 'main', 'shop', h.dir('nowhere')]);
      expect(result.code).toBe(1);
      expect(result.err).toContain(`registered paths: ${native(shop)}`);
    });
  });

  describe('remove', () => {
    it('soft-deletes the project and says its data was kept', async () => {
      const { id } = project('shop');
      const folder = join(h.registryDir, 'projects', id, 'task', 'data');
      mkdirSync(folder, { recursive: true });
      const result = await h.cli(['remove', 'shop']);
      expect(result.code).toBe(0);
      expect(result.out).toBe(`removed shop (${id}); its data folder was kept: ${native(`${h.registryDir.replace(/\\/g, '/')}/projects/${id}`)}`);
      expect(loadRegistry(h.registryDir).projects).toEqual([]);
      expect(loadDeleted(h.registryDir).projects.map((p) => p.id)).toEqual([id]);
      expect(existsSync(folder)).toBe(true);
    });

    it('refuses a project with children and mentions --recursive, then removes both with it', async () => {
      await h.cli(['add', '--virtual', '--name', 'base']);
      await h.cli(['parent', 'set', 'shop', 'base']);
      const refused = await h.cli(['remove', 'base']);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('hint: use --recursive to remove base together with its 1 descendant(s): shop');
      expect(loadRegistry(h.registryDir).projects).toHaveLength(2);
      const done = await h.cli(['remove', 'base', '--recursive']);
      expect(done.code).toBe(0);
      expect(done.out.split('\n')).toHaveLength(2);
      expect(loadRegistry(h.registryDir).projects).toEqual([]);
      expect(loadDeleted(h.registryDir).projects).toHaveLength(2);
    });

    it('prints the deleted entries as JSON', async () => {
      const result = await h.cli(['remove', 'shop', '--json']);
      expect(JSON.parse(result.out)).toMatchObject([{ name: 'shop' }]);
    });

    it('requires an explicit <ref>, even when the cwd is inside a project, and removes nothing', async () => {
      const result = await h.cli(['remove'], { cwd: shop, env: { PROJECT_PROJECT: 'shop' } });
      expect(result.code).toBe(2);
      expect(result.err).toContain('expected <ref>, got none');
      expect(result.err).toContain("Run 'project remove --help' for usage.");
      expect(loadRegistry(h.registryDir).projects).toHaveLength(1);
    });

    it('does not accept --project: the target of a removal is always written as an argument', async () => {
      const result = await h.cli(['remove', '-p', 'shop']);
      expect(result.code).toBe(2);
      expect(result.err).toContain("unknown option '-p' for 'project remove'");
      expect(loadRegistry(h.registryDir).projects).toHaveLength(1);
    });
  });
});
