import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addProject, loadDeleted, loadRegistry, removeProject, toNativePath } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type World, makeModule, makeWorld } from './testKit.js';

let world: World;
beforeEach(() => {
  world = makeWorld();
});
afterEach(() => world.cleanup());

const registry = () => loadRegistry(world.registryDir);
const find = (name: string) => registry().projects.find((p) => p.name === name);

describe('POST /projects', () => {
  it('adds a project with a folder, aliases, labels, a parent and a git url; the folder becomes its main path', async () => {
    const base = await addProject(world.registryDir, { name: 'base' });
    const path = world.folder('shop');
    const { status, body } = await makeModule().call('POST', '/projects', {
      body: { name: 'shop', path, aliases: ['sh'], labels: 'team::blue, shared', parent: 'base', git: 'git@x:shop.git' },
    });
    expect(status).toBe(201);
    expect(body.message).toBe(`Added the project shop (${body.project.id}).`);
    expect(body.project).toMatchObject({ name: 'shop', aliases: ['sh'], parentId: base.id, virtual: false });
    expect(find('shop')).toMatchObject({ labels: expect.arrayContaining(['shared', 'team::blue']), git: 'git@x:shop.git', paths: [{ path, main: true }] });
  });

  it('adds a virtual project (no folder)', async () => {
    const { status, body } = await makeModule().call('POST', '/projects', { body: { name: 'group', virtual: true } });
    expect(status).toBe(201);
    expect(body.project.virtual).toBe(true);
    expect(find('group')?.paths).toEqual([]);
  });

  it('ignores the fields a form leaves empty', async () => {
    const { status } = await makeModule().call('POST', '/projects', { body: { name: 'lone', path: '', parent: '', git: '  ', aliases: '', labels: '' } });
    expect(status).toBe(201);
  });

  it('refuses a folder together with virtual: true, saying which to drop', async () => {
    const { status, body } = await makeModule().call('POST', '/projects', { body: { name: 'x', path: world.folder('x'), virtual: true } });
    expect(status).toBe(400);
    expect(body.message).toContain('virtual');
    expect(body.message).toContain('path');
    expect(find('x')).toBeUndefined();
  });

  it('refuses a folder that does not exist, with the SDK message', async () => {
    const { status, body } = await makeModule().call('POST', '/projects', { body: { name: 'x', path: join(world.root, 'missing') } });
    expect(status).toBe(400);
    expect(body.message).toContain('missing');
    expect(find('x')).toBeUndefined();
  });

  it('refuses a name already taken (409) naming the owner', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const { status, body } = await makeModule().call('POST', '/projects', { body: { name: 'shop' } });
    expect(status).toBe(409);
    expect(body.error).toBe('LABEL_TAKEN');
    expect(body.message).toContain('shop');
  });

  it('refuses an unknown parent (404)', async () => {
    const { status } = await makeModule().call('POST', '/projects', { body: { name: 'x', parent: 'nope' } });
    expect(status).toBe(404);
  });

  it.each([
    [{}, "the field 'name' is required"],
    [{ name: 3 }, "the field 'name' must be text"],
    [{ name: 'x', color: 'red' }, "unknown field 'color'"],
    [{ name: 'x', virtual: 'yes' }, "the field 'virtual' must be true or false"],
    ['text', 'the request body must be a JSON object'],
    [undefined, 'the request body must be a JSON object'],
  ])('validates the body %j', async (body, message) => {
    const result = await makeModule().call('POST', '/projects', { body });
    expect(result.status).toBe(400);
    expect(result.body.message).toContain(message);
    expect(registry().projects).toEqual([]);
  });

  it('two requests at once both succeed with different ids and nothing is lost (the registry lock serializes them)', async () => {
    const module = makeModule();
    const answers = await Promise.all(Array.from({ length: 6 }, (_, i) => module.call('POST', '/projects', { body: { name: `p${i}` } })));
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201, 201, 201]);
    const ids = answers.map((a) => a.body.project.id);
    expect(new Set(ids).size).toBe(6);
    expect(registry().projects.map((p) => p.name).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('two requests for the same name: one wins, the other gets the 409, never two projects', async () => {
    const module = makeModule();
    const answers = await Promise.all([module.call('POST', '/projects', { body: { name: 'same' } }), module.call('POST', '/projects', { body: { name: 'same' } })]);
    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(registry().projects.filter((p) => p.name === 'same')).toHaveLength(1);
  });
});

describe('changes of one project', () => {
  it('renames it (by name, alias or id), and says old and new names', async () => {
    const shop = await addProject(world.registryDir, { name: 'shop', aliases: ['sh'] });
    const module = makeModule();
    const { status, body } = await module.call('PUT', '/projects/sh/name', { body: { name: 'store' } });
    expect(status).toBe(200);
    expect(body.message).toBe("Renamed 'shop' to 'store'.");
    expect(find('store')?.id).toBe(shop.id);
    expect((await module.call('PUT', `/projects/${shop.id}/name`, { body: { ref: shop.id, name: 'store2' } })).status).toBe(200);
  });

  it('adds and removes an alias', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const module = makeModule();
    expect((await module.call('POST', '/projects/shop/aliases', { body: { alias: 'sh' } })).body.message).toBe("Added the alias 'sh' to shop.");
    expect(find('shop')?.aliases).toEqual(['sh']);
    expect((await module.call('DELETE', '/projects/shop/aliases', { body: { alias: 'sh' } })).body.message).toBe("Removed the alias 'sh' from shop.");
    expect(find('shop')?.aliases).toEqual([]);
  });

  it('refuses an alias that is the name of another project (409)', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    await addProject(world.registryDir, { name: 'blog' });
    const { status, body } = await makeModule().call('POST', '/projects/shop/aliases', { body: { alias: 'blog' } });
    expect(status).toBe(409);
    expect(body.error).toBe('LABEL_TAKEN');
  });

  it('adds and removes labels, one or several (list or text)', async () => {
    await addProject(world.registryDir, { name: 'shop', labels: ['old'] });
    const module = makeModule();
    const added = await module.call('POST', '/projects/shop/labels', { body: { labels: 'state::production team::blue' } });
    expect(added.status).toBe(200);
    expect(added.body.message).toBe('Added 2 labels to shop.');
    expect(find('shop')?.labels).toEqual(expect.arrayContaining(['old', 'state::production', 'team::blue']));
    const removed = await module.call('DELETE', '/projects/shop/labels', { body: { labels: ['old'] } });
    expect(removed.body.message).toBe('Removed 1 label from shop.');
    expect(find('shop')?.labels).not.toContain('old');
  });

  it('refuses an invalid label (400) and a removal of a label the project does not have (404), with the SDK message', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const module = makeModule();
    expect((await module.call('POST', '/projects/shop/labels', { body: { labels: ['a::b::c'] } })).status).toBe(400);
    const missing = await module.call('DELETE', '/projects/shop/labels', { body: { labels: ['ghost'] } });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toContain('ghost');
  });

  it('refuses an empty list of labels, saying so', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const { status, body } = await makeModule().call('POST', '/projects/shop/labels', { body: { labels: ' ' } });
    expect(status).toBe(400);
    expect(body.message).toContain("the field 'labels' is required");
  });

  it('sets and clears the parent', async () => {
    const base = await addProject(world.registryDir, { name: 'base' });
    await addProject(world.registryDir, { name: 'shop' });
    const module = makeModule();
    expect((await module.call('PUT', '/projects/shop/parent', { body: { parent: 'base' } })).body.message).toBe('Set the parent of shop to base.');
    expect(find('shop')?.parent).toBe(base.id);
    expect((await module.call('DELETE', '/projects/shop/parent')).body.message).toBe('Cleared the parent of shop.');
    expect(find('shop')?.parent).toBeUndefined();
  });

  it('refuses a parent cycle (409)', async () => {
    await addProject(world.registryDir, { name: 'a' });
    await addProject(world.registryDir, { name: 'b', parent: 'a' });
    const { status, body } = await makeModule().call('PUT', '/projects/a/parent', { body: { parent: 'b' } });
    expect(status).toBe(409);
    expect(body.error).toBe('PARENT_CYCLE');
  });

  it('sets and clears the git url', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const module = makeModule();
    expect((await module.call('PUT', '/projects/shop/git', { body: { git: 'git@x:shop.git' } })).body.message).toBe('Set the git url of shop.');
    expect(find('shop')?.git).toBe('git@x:shop.git');
    expect((await module.call('DELETE', '/projects/shop/git')).body.message).toBe('Cleared the git url of shop.');
    expect(find('shop')?.git).toBeUndefined();
  });
});

describe('paths', () => {
  it('adds a path (the first one becomes the main one), makes another main, moves one, removes one', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const [one, two, three] = [world.folder('one'), world.folder('two'), world.folder('three')] as [string, string, string];
    const module = makeModule();
    expect((await module.call('POST', '/projects/shop/paths', { body: { path: one } })).body.message).toBe(`Added the path ${toNativePath(one)} to shop.`);
    expect(find('shop')?.paths).toEqual([{ path: one, main: true }]);
    await module.call('POST', '/projects/shop/paths', { body: { path: two } });
    expect((await module.call('PUT', '/projects/shop/main', { body: { path: two } })).body.message).toBe(`Set ${toNativePath(two)} as the main path of shop.`);
    expect(find('shop')?.paths.find((p) => p.main)?.path).toBe(two);
    expect((await module.call('PUT', '/projects/shop/paths', { body: { from: one, to: three } })).body.message).toBe(`Moved the path ${toNativePath(one)} to ${toNativePath(three)} for shop.`);
    expect(find('shop')?.paths.map((p) => p.path).sort()).toEqual([three, two].sort());
    expect((await module.call('DELETE', '/projects/shop/paths', { body: { path: three } })).body.message).toBe(`Removed the path ${toNativePath(three)} from shop.`);
    expect(find('shop')?.paths.map((p) => p.path)).toEqual([two]);
  });

  it('adds a path as the main one', async () => {
    await addProject(world.registryDir, { name: 'shop', path: world.folder('one') });
    const two = world.folder('two');
    await makeModule().call('POST', '/projects/shop/paths', { body: { path: two, main: true } });
    expect(find('shop')?.paths.find((p) => p.main)?.path).toBe(two);
  });

  it('refuses a path that belongs to another project (409) naming it', async () => {
    const shared = world.folder('shared');
    await addProject(world.registryDir, { name: 'blog', path: shared });
    await addProject(world.registryDir, { name: 'shop' });
    const { status, body } = await makeModule().call('POST', '/projects/shop/paths', { body: { path: shared } });
    expect(status).toBe(409);
    expect(body.error).toBe('PATH_OWNED');
    expect(body.message).toContain('blog');
  });

  it('refuses to remove the main path while others exist and shows the way out (409 with the hint)', async () => {
    const one = world.folder('one');
    const two = world.folder('two');
    await addProject(world.registryDir, { name: 'shop', path: one });
    await makeModule().call('POST', '/projects/shop/paths', { body: { path: two } });
    const { status, body } = await makeModule().call('DELETE', '/projects/shop/paths', { body: { path: one } });
    expect(status).toBe(409);
    expect(body.error).toBe('MAIN_PATH');
    expect(body.hint).toContain('main path');
    expect(find('shop')?.paths).toHaveLength(2);
  });

  it('removes the main path when the new main one is named', async () => {
    const one = world.folder('one');
    const two = world.folder('two');
    await addProject(world.registryDir, { name: 'shop', path: one });
    await makeModule().call('POST', '/projects/shop/paths', { body: { path: two } });
    const { status } = await makeModule().call('DELETE', '/projects/shop/paths', { body: { path: one, newMain: two } });
    expect(status).toBe(200);
    expect(find('shop')?.paths).toEqual([{ path: two, main: true }]);
  });

  it.each([
    ['POST', '/projects/shop/paths', {}, "the field 'path' is required"],
    ['PUT', '/projects/shop/paths', { from: 'x' }, "the field 'to' is required"],
    ['PUT', '/projects/shop/main', {}, "the field 'path' is required"],
    ['PUT', '/projects/shop/name', {}, "the field 'name' is required"],
    ['PUT', '/projects/shop/parent', {}, "the field 'parent' is required"],
    ['PUT', '/projects/shop/git', {}, "the field 'git' is required"],
    ['POST', '/projects/shop/aliases', {}, "the field 'alias' is required"],
    ['DELETE', '/projects/shop/aliases', { alias: 'x', extra: 1 }, "unknown field 'extra'"],
  ])('validates the body of %s %s', async (method, path, body, message) => {
    await addProject(world.registryDir, { name: 'shop' });
    const result = await makeModule().call(method, path, { body });
    expect(result.status).toBe(400);
    expect(result.body.message).toContain(message);
  });
});

describe('remove and restore', () => {
  it('removes a project (it goes to the trash, with its folders kept) and says so', async () => {
    const shop = await addProject(world.registryDir, { name: 'shop' });
    const { status, body } = await makeModule().call('DELETE', `/projects/${shop.id}`);
    expect(status).toBe(200);
    expect(body.message).toBe('Removed shop. It is in the trash and can be restored.');
    expect(body.removed).toEqual([{ id: shop.id, name: 'shop' }]);
    expect(find('shop')).toBeUndefined();
    expect(loadDeleted(world.registryDir).projects.map((p) => p.id)).toEqual([shop.id]);
  });

  it('refuses a project with children (409) and the hint tells to tick the recursive option; with it, removes all', async () => {
    const base = await addProject(world.registryDir, { name: 'base' });
    await addProject(world.registryDir, { name: 'kid', parent: 'base' });
    const module = makeModule();
    const refused = await module.call('DELETE', `/projects/${base.id}`, { body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('HAS_CHILDREN');
    expect(refused.body.message).toContain('Also remove the descendants');
    expect(registry().projects).toHaveLength(2);
    const done = await module.call('DELETE', `/projects/${base.id}`, { body: { ref: base.id, recursive: true } });
    expect(done.status).toBe(200);
    expect(done.body.removed.map((r: { name: string }) => r.name).sort()).toEqual(['base', 'kid']);
    expect(done.body.message).toBe('Removed base and 1 descendant. They are in the trash and can be restored.');
    expect(registry().projects).toEqual([]);
  });

  it('404 for an unknown project', async () => {
    expect((await makeModule().call('DELETE', '/projects/ghost')).status).toBe(404);
  });

  it('restores a removed project', async () => {
    const shop = await addProject(world.registryDir, { name: 'shop' });
    await removeProject(world.registryDir, shop.id);
    const { status, body } = await makeModule().call('POST', `/deleted/${shop.id}/restore`, { body: { ref: shop.id } });
    expect(status).toBe(200);
    expect(body.message).toBe('Restored shop.');
    expect(body.restored).toEqual([{ id: shop.id, name: 'shop' }]);
    expect(find('shop')?.id).toBe(shop.id);
    expect(loadDeleted(world.registryDir).projects).toEqual([]);
  });

  it('restores with the descendants when recursive, and refuses a child whose parent is still in the trash (409, actionable)', async () => {
    const base = await addProject(world.registryDir, { name: 'base' });
    const kid = await addProject(world.registryDir, { name: 'kid', parent: 'base' });
    await removeProject(world.registryDir, base.id, { recursive: true });
    const module = makeModule();
    const refused = await module.call('POST', `/deleted/${kid.id}/restore`, { body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.message.length).toBeGreaterThan(20);
    expect(registry().projects).toEqual([]);
    const done = await module.call('POST', `/deleted/${base.id}/restore`, { body: { recursive: true } });
    expect(done.status).toBe(200);
    expect(done.body.message).toBe('Restored base and 1 descendant.');
    expect(registry().projects.map((p) => p.name).sort()).toEqual(['base', 'kid']);
  });

  it('refuses a restore whose name was taken meanwhile (409)', async () => {
    const shop = await addProject(world.registryDir, { name: 'shop' });
    await removeProject(world.registryDir, shop.id);
    await addProject(world.registryDir, { name: 'shop' });
    const { status, body } = await makeModule().call('POST', `/deleted/${shop.id}/restore`, { body: {} });
    expect(status).toBe(409);
    expect(body.error).toBe('RESTORE_CONFLICT');
  });

  it('404 for a project that is not in the trash', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    expect((await makeModule().call('POST', '/deleted/shop/restore', { body: {} })).status).toBe(404);
  });
});

describe('traceability and isolation', () => {
  it('writes each change in the daily log of the registry folder: names and ids, no values', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    await makeModule().call('PUT', '/projects/shop/git', { body: { git: 'git@secret-host:x.git' } });
    const day = new Date().toISOString().slice(0, 10);
    const text = readFileSync(join(world.registryDir, 'logs', `${day}.ndjson`), 'utf8');
    expect(text).toContain('mutation:');
    expect(text).toContain('via the project module');
    expect(text).not.toContain('secret-host');
  });

  it('does not log a refused change', async () => {
    await makeModule().call('PUT', '/projects/ghost/git', { body: { git: 'x' } });
    expect(existsSync(join(world.registryDir, 'logs'))).toBe(false);
  });
});
