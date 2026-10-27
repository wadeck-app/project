import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AmbiguousReferenceError, ProjectNotFoundError, RestoreConflictError } from './errors.js';
import { addPath } from './pathMutations.js';
import { addLabels } from './labelMutations.js';
import { addAlias, addProject, setGit } from './projectMutations.js';
import { deletedFilePath, loadDeleted, loadRegistry, registryFilePath } from './registryIo.js';
import { removeProject } from './removal.js';
import { restoreProject } from './restore.js';
import { toNativePath } from './paths.js';
import { type Workspace, makeWorkspace } from './testHelpers.js';

describe('restoreProject', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });
  afterEach(() => ws.cleanup());

  const live = () => loadRegistry(ws.registryDir).projects;
  const deleted = () => loadDeleted(ws.registryDir).projects;
  const names = (projects: { name: string }[]) => projects.map((p) => p.name).sort();

  async function removedShop() {
    const shop = await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'], path: ws.dir('shop'), git: 'git@x:shop.git', labels: ['state::production'] });
    await removeProject(ws.registryDir, 'shop');
    return shop;
  }

  it('brings a project back by its exact id, with everything it had, and removes it from the deleted file', async () => {
    const shop = await removedShop();
    const restored = await restoreProject(ws.registryDir, shop.id);
    expect(restored).toEqual([shop]);
    expect(restored[0]).not.toHaveProperty('deletedAt');
    expect(live()).toEqual([shop]);
    expect(deleted()).toEqual([]);
  });

  it('finds it by exact name or alias too, in any case', async () => {
    const shop = await removedShop();
    expect((await restoreProject(ws.registryDir, 'SH'))[0]!.id).toBe(shop.id);
    await removeProject(ws.registryDir, 'shop');
    expect((await restoreProject(ws.registryDir, 'Shop'))[0]!.id).toBe(shop.id);
  });

  it('keeps the data folder of the project: it was never deleted', async () => {
    const shop = await removedShop();
    const data = join(ws.registryDir, 'projects', shop.id, 'task', 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'index.json'), 'kept');
    await restoreProject(ws.registryDir, shop.id);
    expect(readFileSync(join(data, 'index.json'), 'utf8')).toBe('kept');
  });

  describe('finding the project', () => {
    it('lists the ids and the deletion dates when several deleted projects have the name, and restores by id', async () => {
      const first = await addProject(ws.registryDir, { name: 'shop' });
      await removeProject(ws.registryDir, 'shop');
      const second = await addProject(ws.registryDir, { name: 'shop' });
      await removeProject(ws.registryDir, 'shop');
      const error = (await restoreProject(ws.registryDir, 'shop').catch((e: unknown) => e)) as AmbiguousReferenceError;
      expect(error).toBeInstanceOf(AmbiguousReferenceError);
      expect(error.candidates.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
      for (const entry of deleted()) {
        expect(error.message).toContain(`${entry.id} (deleted ${entry.deletedAt})`);
      }
      expect(error.message).toContain('restore by id');
      expect((await restoreProject(ws.registryDir, second.id))[0]!.id).toBe(second.id);
      expect(deleted().map((p) => p.id)).toEqual([first.id]);
    });

    it('suggests close names of deleted projects when nothing matches, as resolveReference does', async () => {
      await removedShop();
      const error = (await restoreProject(ws.registryDir, 'shpo').catch((e: unknown) => e)) as ProjectNotFoundError;
      expect(error).toBeInstanceOf(ProjectNotFoundError);
      expect(error.message).toContain("no deleted project matches 'shpo'");
      expect(error.message).toContain('did you mean');
      expect(error.suggestions.map((s) => s.text)).toContain('shop');
      expect(deleted()).toHaveLength(1);
    });

    it('does not look at live projects, and says so when the id is already live', async () => {
      const kept = await addProject(ws.registryDir, { name: 'kept' });
      await expect(restoreProject(ws.registryDir, 'kept')).rejects.toThrow(/no deleted project matches 'kept'/);
      await expect(restoreProject(ws.registryDir, kept.id)).rejects.toThrow(/already live/);
    });

    it('says what to do when there is nothing deleted at all', async () => {
      await expect(restoreProject(ws.registryDir, 'x')).rejects.toThrow(/no deleted project matches 'x'.*nothing was deleted/);
    });
  });

  describe('conflicts with live projects (nothing changes)', () => {
    const untouched = async (before: { registry: string; deleted: string }) => {
      expect(readFileSync(registryFilePath(ws.registryDir), 'utf8')).toBe(before.registry);
      expect(readFileSync(deletedFilePath(ws.registryDir), 'utf8')).toBe(before.deleted);
    };
    const snapshot = () => ({ registry: readFileSync(registryFilePath(ws.registryDir), 'utf8'), deleted: readFileSync(deletedFilePath(ws.registryDir), 'utf8') });

    it('refuses a name used by a live project, naming it and the fix', async () => {
      const shop = await removedShop();
      await addProject(ws.registryDir, { name: 'shop' });
      const before = snapshot();
      const error = (await restoreProject(ws.registryDir, shop.id).catch((e: unknown) => e)) as RestoreConflictError;
      expect(error).toBeInstanceOf(RestoreConflictError);
      expect(error.code).toBe('RESTORE_CONFLICT');
      expect(error.project).toMatchObject({ id: shop.id, name: 'shop' });
      expect(error.conflictsWith).toMatchObject({ name: 'shop' });
      expect(error.message).toContain(`cannot restore shop (${shop.id})`);
      expect(error.message).toContain("name 'shop'");
      expect(error.message).toMatch(/live project shop \([0-9a-f]{8}\)/);
      expect(error.message).toMatch(/rename or remove/);
      await untouched(before);
    });

    it('refuses an alias used by a live project', async () => {
      const shop = await removedShop();
      await addProject(ws.registryDir, { name: 'other' });
      await addAlias(ws.registryDir, 'other', 'sh');
      await expect(restoreProject(ws.registryDir, shop.id)).rejects.toThrow(/alias 'sh'.*live project other/s);
    });

    it('refuses a path that a live project registered since, showing it natively', async () => {
      const shop = await removedShop();
      await addProject(ws.registryDir, { name: 'squatter', path: ws.dir('shop') });
      const error = (await restoreProject(ws.registryDir, shop.id).catch((e: unknown) => e)) as RestoreConflictError;
      expect(error).toBeInstanceOf(RestoreConflictError);
      expect(error.message).toContain(`path ${toNativePath(ws.dir('shop'))}`);
      expect(error.message).toContain('live project squatter');
    });

    it('refuses a path that no longer exists, saying to recreate the folder', async () => {
      const shop = await removedShop();
      rmSync(ws.dir('shop'), { recursive: true });
      const error = (await restoreProject(ws.registryDir, shop.id).catch((e: unknown) => e)) as RestoreConflictError;
      expect(error).toBeInstanceOf(RestoreConflictError);
      expect(error.message).toContain('does not exist');
      expect(error.message).toContain('recreate the folder');
      expect(deleted()).toHaveLength(1);
    });
  });

  describe('the parent', () => {
    async function removedTree() {
      const base = await addProject(ws.registryDir, { name: 'base', labels: ['shared'] });
      const mid = await addProject(ws.registryDir, { name: 'mid', parent: 'base', path: ws.dir('mid') });
      const leaf = await addProject(ws.registryDir, { name: 'leaf', parent: 'mid' });
      await removeProject(ws.registryDir, 'base', { recursive: true });
      return { base, mid, leaf };
    }

    it('must be live: restoring a child of a deleted parent says to restore the parent first', async () => {
      const { mid } = await removedTree();
      const error = (await restoreProject(ws.registryDir, 'mid').catch((e: unknown) => e)) as RestoreConflictError;
      expect(error).toBeInstanceOf(RestoreConflictError);
      expect(error.message).toContain('its parent base');
      expect(error.message).toMatch(/restore the parent first/);
      expect(error.project.id).toBe(mid.id);
      expect(live()).toEqual([]);
    });

    it('restores a project whose parent is live, and the children stay deleted without recursive', async () => {
      const { base, mid, leaf } = await removedTree();
      await restoreProject(ws.registryDir, base.id);
      expect(names(live())).toEqual(['base']);
      await restoreProject(ws.registryDir, mid.id);
      expect(names(live())).toEqual(['base', 'mid']);
      expect(deleted().map((p) => p.id)).toEqual([leaf.id]);
    });

    it('with recursive, restores the project and every deleted descendant, parents before children', async () => {
      const { base } = await removedTree();
      const restored = await restoreProject(ws.registryDir, 'base', { recursive: true });
      expect(restored.map((p) => p.name)).toEqual(['base', 'mid', 'leaf']);
      expect(names(live())).toEqual(['base', 'leaf', 'mid']);
      expect(deleted()).toEqual([]);
      expect(live().find((p) => p.name === 'leaf')!.parent).toBe(live().find((p) => p.name === 'mid')!.id);
      expect(live().find((p) => p.id === base.id)!.labels).toEqual(['shared']);
    });

    it('with recursive, restores all of them or none: one descendant that does not validate stops everything', async () => {
      await removedTree();
      await addProject(ws.registryDir, { name: 'leaf' });
      const error = (await restoreProject(ws.registryDir, 'base', { recursive: true }).catch((e: unknown) => e)) as RestoreConflictError;
      expect(error).toBeInstanceOf(RestoreConflictError);
      expect(error.project.name).toBe('leaf');
      expect(names(live())).toEqual(['leaf']);
      expect(deleted()).toHaveLength(3);
    });

    it('ignores descendants that are live already, and deleted projects that are not below it', async () => {
      const { base } = await removedTree();
      await addProject(ws.registryDir, { name: 'unrelated' });
      await removeProject(ws.registryDir, 'unrelated');
      const restored = await restoreProject(ws.registryDir, base.id, { recursive: true });
      expect(restored).toHaveLength(3);
      expect(deleted().map((p) => p.name)).toEqual(['unrelated']);
    });
  });

  describe('a crash between the two writes', () => {
    it('an id present in both files is live: it cannot be restored, and the stale deleted entry is dropped by the next restore', async () => {
      const shop = await removedShop();
      await restoreProject(ws.registryDir, shop.id);
      // What a crash after writing registry.json leaves: the entry is still in deleted_projects.json.
      writeFileSync(deletedFilePath(ws.registryDir), JSON.stringify({ schemaVersion: 1, projects: [{ ...shop, deletedAt: '2026-10-20T00:00:00.000Z' }] }));
      await expect(restoreProject(ws.registryDir, shop.id)).rejects.toThrow(/already live/);
      const other = await addProject(ws.registryDir, { name: 'other' });
      await removeProject(ws.registryDir, 'other');
      await restoreProject(ws.registryDir, other.id);
      expect(deleted()).toEqual([]);
    });

    it('a removal drops the stale deleted entry as well', async () => {
      const shop = await removedShop();
      await restoreProject(ws.registryDir, shop.id);
      writeFileSync(deletedFilePath(ws.registryDir), JSON.stringify({ schemaVersion: 1, projects: [{ ...shop, deletedAt: '2026-10-20T00:00:00.000Z' }] }));
      await addProject(ws.registryDir, { name: 'other' });
      await removeProject(ws.registryDir, 'other');
      expect(deleted().map((p) => p.name)).toEqual(['other']);
    });
  });

  it('works with the other mutations after it: the restored project is a normal live project', async () => {
    const shop = await removedShop();
    await restoreProject(ws.registryDir, shop.id);
    await addPath(ws.registryDir, 'shop', ws.dir('wt'));
    await addLabels(ws.registryDir, 'shop', ['x']);
    await setGit(ws.registryDir, 'shop', null);
    expect(live()[0]).toMatchObject({ name: 'shop', labels: ['state::production', 'x'] });
  });
});
