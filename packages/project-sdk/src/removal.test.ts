import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AtomicWriteError, HasChildrenError, ProjectNotFoundError } from './errors.js';
import { addProject } from './projectMutations.js';
import { deletedFilePath, loadDeleted, loadRegistry, registryFilePath } from './registryIo.js';
import { removeProject } from './removal.js';
import { type Workspace, makeWorkspace } from './testHelpers.js';

describe('removeProject', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  const names = (projects: { name: string }[]): string[] => projects.map((p) => p.name).sort();

  it('soft-deletes: the entry moves to deleted_projects.json with deletedAt, the folder is kept', async () => {
    const shop = await addProject(ws.registryDir, { name: 'shop', path: ws.dir('shop') });
    await addProject(ws.registryDir, { name: 'blog' });
    const folder = join(ws.registryDir, 'projects', shop.id, 'task', 'data');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'tasks.json'), '{}');

    const removed = await removeProject(ws.registryDir, 'shop');

    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ ...shop });
    expect(Number.isNaN(Date.parse(removed[0]!.deletedAt))).toBe(false);
    expect(names(loadRegistry(ws.registryDir).projects)).toEqual(['blog']);
    expect(loadDeleted(ws.registryDir).projects).toEqual(removed);
    expect(readFileSync(join(folder, 'tasks.json'), 'utf8')).toBe('{}');
  });

  it('appends to an existing deleted file instead of replacing it', async () => {
    await addProject(ws.registryDir, { name: 'a' });
    await addProject(ws.registryDir, { name: 'b' });
    await removeProject(ws.registryDir, 'a');
    await removeProject(ws.registryDir, 'b');
    expect(loadDeleted(ws.registryDir).projects.map((p) => p.name)).toEqual(['a', 'b']);
    expect(loadRegistry(ws.registryDir).projects).toEqual([]);
  });

  it('frees the name, aliases and path of the deleted project', async () => {
    const path = ws.dir('shop');
    await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'], path });
    await removeProject(ws.registryDir, 'shop');
    const again = await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'], path });
    expect(again.name).toBe('shop');
    expect(loadDeleted(ws.registryDir).projects[0]!.id).not.toBe(again.id);
  });

  it('refuses a project with children, naming the descendants, and changes nothing', async () => {
    await addProject(ws.registryDir, { name: 'root' });
    await addProject(ws.registryDir, { name: 'kid', parent: 'root' });
    const error = await removeProject(ws.registryDir, 'root').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HasChildrenError);
    expect((error as Error).message).toMatch(/kid.*descendants/s);
    expect(names(loadRegistry(ws.registryDir).projects)).toEqual(['kid', 'root']);
    expect(existsSync(deletedFilePath(ws.registryDir))).toBe(false);
  });

  it('with recursive, soft-deletes the project and all descendants together, keeping the others', async () => {
    await addProject(ws.registryDir, { name: 'root' });
    await addProject(ws.registryDir, { name: 'kid', parent: 'root' });
    await addProject(ws.registryDir, { name: 'grandkid', parent: 'kid' });
    await addProject(ws.registryDir, { name: 'other' });
    const removed = await removeProject(ws.registryDir, 'root', { recursive: true });
    expect(removed.map((p) => p.name)).toEqual(['root', 'kid', 'grandkid']);
    expect(names(loadRegistry(ws.registryDir).projects)).toEqual(['other']);
    expect(names(loadDeleted(ws.registryDir).projects)).toEqual(['grandkid', 'kid', 'root']);
  });

  it('removes a leaf child without touching its parent', async () => {
    await addProject(ws.registryDir, { name: 'root' });
    await addProject(ws.registryDir, { name: 'kid', parent: 'root' });
    await removeProject(ws.registryDir, 'kid');
    expect(names(loadRegistry(ws.registryDir).projects)).toEqual(['root']);
  });

  it('fails on an unknown project', async () => {
    await expect(removeProject(ws.registryDir, 'ghost')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  // A read-only registry.json makes the final rename fail on Windows, after the deleted file was written.
  it.runIf(process.platform === 'win32')('writes the deleted file before registry.json, so a crash never loses an entry (win32)', async () => {
    await addProject(ws.registryDir, { name: 'shop' });
    chmodSync(registryFilePath(ws.registryDir), 0o444);
    try {
      await expect(removeProject(ws.registryDir, 'shop')).rejects.toBeInstanceOf(AtomicWriteError);
      expect(loadDeleted(ws.registryDir).projects.map((p) => p.name)).toEqual(['shop']);
    } finally {
      chmodSync(registryFilePath(ws.registryDir), 0o666);
    }
  });
});
