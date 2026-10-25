import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findProjectIncludingDeleted } from './deletedLookup.js';
import { addProject } from './projectMutations.js';
import { loadDeleted } from './registryIo.js';
import { removeProject } from './removal.js';
import { type Workspace, makeWorkspace } from './testHelpers.js';

describe('findProjectIncludingDeleted', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });
  afterEach(() => ws.cleanup());

  it('finds a live project by its exact id', async () => {
    const shop = await addProject(ws.registryDir, { name: 'shop', labels: ['sandbox'] });
    expect(findProjectIncludingDeleted(ws.registryDir, shop.id)).toEqual({ project: shop, deleted: false });
  });

  it('still finds a soft-deleted project by its id, flagged, with the date, and without the deletedAt field in the project', async () => {
    const shop = await addProject(ws.registryDir, { name: 'shop', labels: ['sandbox'] });
    await removeProject(ws.registryDir, 'shop');
    const found = findProjectIncludingDeleted(ws.registryDir, shop.id);
    expect(found).toEqual({ project: shop, deleted: true, deletedAt: loadDeleted(ws.registryDir).projects[0]!.deletedAt });
    expect(found?.project).not.toHaveProperty('deletedAt');
  });

  it('prefers the live project when an id exists in both files (a manual restore)', async () => {
    const shop = await addProject(ws.registryDir, { name: 'shop' });
    await removeProject(ws.registryDir, 'shop');
    const restored = await addProject(ws.registryDir, { name: 'shop' });
    expect(findProjectIncludingDeleted(ws.registryDir, restored.id)?.deleted).toBe(false);
    expect(findProjectIncludingDeleted(ws.registryDir, shop.id)?.deleted).toBe(true);
  });

  it('matches the exact id only: not a name, an alias, nor a prefix', async () => {
    const shop = await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'] });
    expect(findProjectIncludingDeleted(ws.registryDir, 'shop')).toBeUndefined();
    expect(findProjectIncludingDeleted(ws.registryDir, 'sh')).toBeUndefined();
    expect(findProjectIncludingDeleted(ws.registryDir, shop.id.slice(0, 5))).toBeUndefined();
    expect(findProjectIncludingDeleted(ws.registryDir, '')).toBeUndefined();
  });

  it('accepts the id in upper case (ids are lowercase hex)', async () => {
    const shop = await addProject(ws.registryDir, { name: 'shop' });
    expect(findProjectIncludingDeleted(ws.registryDir, shop.id.toUpperCase())?.project.id).toBe(shop.id);
  });

  it('is undefined for an unknown id, also on an empty registry', async () => {
    expect(findProjectIncludingDeleted(ws.registryDir, 'deadbeef')).toBeUndefined();
    await addProject(ws.registryDir, { name: 'shop' });
    expect(findProjectIncludingDeleted(ws.registryDir, 'deadbeef')).toBeUndefined();
  });
});
