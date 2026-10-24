import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidProjectLabelError, ProjectLabelNotFoundError } from './errors.js';
import { addLabels, removeLabels } from './labelMutations.js';
import { addProject, renameProject } from './projectMutations.js';
import { deletedFilePath, loadDeleted, loadRegistry, registryFilePath } from './registryIo.js';
import { removeProject } from './removal.js';
import { type Workspace, makeWorkspace } from './testHelpers.js';

describe('project labels on disk', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });
  afterEach(() => ws.cleanup());

  const stored = (name: string) => loadRegistry(ws.registryDir).projects.find((p) => p.name === name)!;

  it('addProject writes labels (always a list), normalized, without duplicates', async () => {
    const plain = await addProject(ws.registryDir, { name: 'plain' });
    expect(plain.labels).toEqual([]);
    const shop = await addProject(ws.registryDir, { name: 'shop', labels: ['State::Production', 'sandbox', 'state::production'] });
    expect(shop.labels).toEqual(['state::production', 'sandbox']);
    expect(stored('shop').labels).toEqual(['state::production', 'sandbox']);
  });

  it('addProject refuses an invalid label and more than 32, writing nothing', async () => {
    await expect(addProject(ws.registryDir, { name: 'shop', labels: ['a::b::c'] })).rejects.toBeInstanceOf(InvalidProjectLabelError);
    await expect(addProject(ws.registryDir, { name: 'shop', labels: Array.from({ length: 33 }, (_, i) => `l${i}`) })).rejects.toThrow(/at most 32 labels/);
    expect(loadRegistry(ws.registryDir).projects).toEqual([]);
  });

  describe('addLabels', () => {
    it('adds labels as a set: an existing label is a no-op that still returns the project', async () => {
      await addProject(ws.registryDir, { name: 'shop', labels: ['sandbox'] });
      const project = await addLabels(ws.registryDir, 'shop', ['Sandbox', 'state::temp', 'state::production', 'state::temp']);
      expect(project.labels).toEqual(['sandbox', 'state::temp', 'state::production']);
      const again = await addLabels(ws.registryDir, 'shop', ['sandbox']);
      expect(again.labels).toEqual(['sandbox', 'state::temp', 'state::production']);
    });

    it('treats a project of an old registry (no labels field) as having none', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      const raw = JSON.parse(readFileSync(registryFilePath(ws.registryDir), 'utf8')) as { projects: Record<string, unknown>[] };
      delete raw.projects[0]!['labels'];
      writeFileSync(registryFilePath(ws.registryDir), JSON.stringify(raw));
      expect(loadRegistry(ws.registryDir).projects[0]!.labels).toBeUndefined();
      const project = await addLabels(ws.registryDir, 'shop', ['sandbox']);
      expect(project.labels).toEqual(['sandbox']);
    });

    it('refuses an invalid label and changes nothing, even for the valid ones of the same call', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      await expect(addLabels(ws.registryDir, 'shop', ['ok', 'a b'])).rejects.toBeInstanceOf(InvalidProjectLabelError);
      expect(stored('shop').labels).toEqual([]);
    });

    it('refuses to go over 32 labels, naming the limit', async () => {
      await addProject(ws.registryDir, { name: 'shop', labels: Array.from({ length: 32 }, (_, i) => `l${i}`) });
      await expect(addLabels(ws.registryDir, 'shop', ['one-more'])).rejects.toThrow(/at most 32 labels per project/);
      await expect(addLabels(ws.registryDir, 'shop', ['l1'])).resolves.toBeDefined();
    });

    it('resolves the reference like the other mutations', async () => {
      await addProject(ws.registryDir, { name: 'shop', aliases: ['sh'] });
      await expect(addLabels(ws.registryDir, 'sh', ['x'])).resolves.toMatchObject({ name: 'shop' });
      await expect(addLabels(ws.registryDir, 'nope', ['x'])).rejects.toThrow(/no project matches/);
    });
  });

  describe('removeLabels', () => {
    it('removes labels', async () => {
      await addProject(ws.registryDir, { name: 'shop', labels: ['a', 'k::v', 'k::w'] });
      const project = await removeLabels(ws.registryDir, 'shop', ['A', 'k::v']);
      expect(project.labels).toEqual(['k::w']);
    });

    it('fails loudly, naming the label and the existing ones, when a label is absent, and removes nothing', async () => {
      await addProject(ws.registryDir, { name: 'shop', labels: ['a', 'b'] });
      const error = (await removeLabels(ws.registryDir, 'shop', ['a', 'sandbxo']).catch((e: unknown) => e)) as ProjectLabelNotFoundError;
      expect(error).toBeInstanceOf(ProjectLabelNotFoundError);
      expect(error).toMatchObject({ code: 'PROJECT_LABEL_NOT_FOUND', label: 'sandbxo', project: { name: 'shop' } });
      expect(error.message).toContain("'sandbxo'");
      expect(error.message).toContain('its labels: a, b');
      expect(stored('shop').labels).toEqual(['a', 'b']);
    });

    it('says so when the project has no labels at all', async () => {
      await addProject(ws.registryDir, { name: 'shop' });
      await expect(removeLabels(ws.registryDir, 'shop', ['a'])).rejects.toThrow(/its labels: none/);
    });
  });

  it('labels are kept by a rename and by the soft delete, and are not inherited', async () => {
    await addProject(ws.registryDir, { name: 'base', labels: ['state::production'] });
    await addProject(ws.registryDir, { name: 'kid', parent: 'base' });
    expect(stored('kid').labels).toEqual([]);
    await renameProject(ws.registryDir, 'base', 'root');
    expect(stored('root').labels).toEqual(['state::production']);
    await removeProject(ws.registryDir, 'root', { recursive: true });
    const deleted = loadDeleted(ws.registryDir).projects;
    expect(deleted.find((p) => p.name === 'root')!.labels).toEqual(['state::production']);
    expect(readFileSync(deletedFilePath(ws.registryDir), 'utf8')).toContain('state::production');
  });

  it('the write validation refuses labels that were written by hand wrongly', async () => {
    await addProject(ws.registryDir, { name: 'shop' });
    const raw = JSON.parse(readFileSync(registryFilePath(ws.registryDir), 'utf8')) as { projects: Record<string, unknown>[] };
    raw.projects[0]!['labels'] = ['Bad Label'];
    writeFileSync(registryFilePath(ws.registryDir), JSON.stringify(raw));
    await expect(renameProject(ws.registryDir, 'shop', 'store')).rejects.toThrow(/invalid label.*Bad Label/s);
  });

  it('loading refuses a labels field that is not a list of strings', () => {
    mkdirSync(ws.registryDir, { recursive: true });
    writeFileSync(
      registryFilePath(ws.registryDir),
      JSON.stringify({ schemaVersion: 1, projects: [{ id: 'aaaaaaaa', name: 'a', aliases: [], paths: [], labels: 'sandbox', createdAt: 'x' }] }),
    );
    expect(() => loadRegistry(ws.registryDir)).toThrow(/labels/);
  });
});
