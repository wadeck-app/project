import { readFileSync, writeFileSync } from 'node:fs';
import { addProject, registryFilePath, removeProject, setParent } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type World, makeModule, makeWorld } from './testKit.js';

let world: World;
beforeEach(() => {
  world = makeWorld();
});
afterEach(() => world.cleanup());

async function seed() {
  const base = await addProject(world.registryDir, { name: 'base', labels: ['shared'] });
  const shop = await addProject(world.registryDir, { name: 'shop', aliases: ['sh'], path: world.folder('shop'), parent: base.id, labels: ['state::production', 'team::blue'], git: 'git@x:shop.git' });
  const blog = await addProject(world.registryDir, { name: 'blog', path: world.folder('blog'), labels: ['state::sandbox'] });
  return { base, shop, blog };
}

const namesOf = (projects: { name: string }[]): string[] => projects.map((p) => p.name);

describe('route list', () => {
  it('registers exactly the documented routes', () => {
    expect(makeModule().routes.sort()).toEqual(
      [
        'GET /projects',
        'POST /projects',
        'GET /projects/:ref',
        'DELETE /projects/:ref',
        'GET /projects/:ref/related',
        'PUT /projects/:ref/name',
        'POST /projects/:ref/aliases',
        'DELETE /projects/:ref/aliases',
        'POST /projects/:ref/labels',
        'DELETE /projects/:ref/labels',
        'PUT /projects/:ref/parent',
        'DELETE /projects/:ref/parent',
        'PUT /projects/:ref/git',
        'DELETE /projects/:ref/git',
        'POST /projects/:ref/paths',
        'DELETE /projects/:ref/paths',
        'PUT /projects/:ref/paths',
        'PUT /projects/:ref/main',
        'GET /tree',
        'GET /deleted',
        'POST /deleted/:ref/restore',
      ].sort(),
    );
  });
});

describe('GET /projects', () => {
  it('is empty and says so for a registry that does not exist yet (nothing is created by reading)', async () => {
    const { status, body } = await makeModule().call('GET', '/projects');
    expect(status).toBe(200);
    expect(body).toMatchObject({ count: 0, total: 0, projects: [], parentOptions: [], emptyText: expect.stringContaining('No project is registered') });
  });

  it('lists every project with the data and the text of its columns', async () => {
    const { shop } = await seed();
    const { body } = await makeModule().call('GET', '/projects');
    expect(body.count).toBe(3);
    expect(body.total).toBe(3);
    // True on every answer that carries the list, even an empty one: the page shows the table and the add form only then.
    expect(body.ready).toBe(true);
    const row = body.projects.find((p: { id: string }) => p.id === shop.id);
    expect(row).toMatchObject({ name: 'shop', aliasesText: 'sh', parentName: 'base', labelsText: 'state::production, team::blue', virtual: false, href: `/modules/project/p/${shop.id}` });
    expect(body.projects.find((p: { name: string }) => p.name === 'base')).toMatchObject({ virtual: true, virtualText: 'virtual' });
    expect(body.parentOptions).toEqual(expect.arrayContaining([{ value: shop.id, label: 'shop' }]));
  });

  it('reads the registry on every request (a change made by the CLI shows at once)', async () => {
    const module = makeModule();
    expect((await module.call('GET', '/projects')).body.count).toBe(0);
    await addProject(world.registryDir, { name: 'late' });
    expect((await module.call('GET', '/projects')).body.count).toBe(1);
  });

  it('filters by one label selector, exact and with wildcards', async () => {
    await seed();
    const module = makeModule();
    const names = async (url: string) => namesOf((await module.call('GET', url)).body.projects).sort();
    expect(await names('/projects?label=state::production')).toEqual(['shop']);
    expect(await names('/projects?label=state::*')).toEqual(['blog', 'shop']);
    expect(await names('/projects?label=shared')).toEqual(['base']);
  });

  it('repeating label means all of the selectors (AND)', async () => {
    await seed();
    const { body } = await makeModule().call('GET', '/projects?label=state::*&label=team::blue');
    expect(namesOf(body.projects)).toEqual(['shop']);
    expect(body.total).toBe(3);
    expect(body.count).toBe(1);
  });

  it('filters by text on the name, the aliases, the id, the labels and the paths, ignoring the case', async () => {
    const { shop } = await seed();
    const module = makeModule();
    const names = async (q: string) => namesOf((await module.call('GET', `/projects?q=${encodeURIComponent(q)}`)).body.projects);
    expect(await names('SHOP')).toEqual(['shop']);
    // The text is a part of the value: 'sh' is in the alias of shop and in the label 'shared' of base.
    expect(await names('sh')).toEqual(['base', 'shop']);
    expect(await names('store')).toEqual([]);
    expect(await names(shop.id.toUpperCase())).toEqual(['shop']);
    expect(await names('team::blue')).toEqual(['shop']);
    expect(await names('blog')).toEqual(['blog']);
    expect(await names('nothing-like-this')).toEqual([]);
  });

  it('combines the selector and the text, and ignores an empty filter field (a cleared form field sends ?q=)', async () => {
    await seed();
    const module = makeModule();
    expect(namesOf((await module.call('GET', '/projects?label=state::*&q=blo')).body.projects)).toEqual(['blog']);
    expect((await module.call('GET', '/projects?label=&q=')).body.count).toBe(3);
  });

  it('refuses an invalid selector with 400 and a message that says what is wrong', async () => {
    await seed();
    const { status, body } = await makeModule().call('GET', '/projects?label=bad%20label');
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_LABEL_SELECTOR');
    expect(body.message).toContain('bad label');
  });

  it('with inlineErrors an invalid selector is data (200, failed, errorText), so that the page stays and shows it', async () => {
    const { status, body } = await makeModule().call('GET', '/projects?label=bad%20label&inlineErrors=true');
    expect(status).toBe(200);
    expect(body).toMatchObject({ failed: true, httpStatus: 400, errorText: expect.stringContaining('bad label') });
  });

  it('refuses a repeated q (it is a single text)', async () => {
    const { status, body } = await makeModule().call('GET', '/projects?q=a&q=b');
    expect(status).toBe(400);
    expect(body.message).toContain("'q' must be given once");
  });
});

describe('GET /projects/:ref', () => {
  it('finds a project by id, by name and by alias, with the same answer', async () => {
    const { shop } = await seed();
    const module = makeModule();
    for (const ref of [shop.id, 'shop', 'sh']) {
      const { status, body } = await module.call('GET', `/projects/${ref}`);
      expect(status, ref).toBe(200);
      expect(body.project).toMatchObject({ id: shop.id, name: 'shop', chainText: 'base > shop', gitText: 'git@x:shop.git', parentText: 'base' });
    }
  });

  it('gives the options of the forms (what can be removed, which parents can be chosen) and the prefilled forms', async () => {
    const { base, shop, blog } = await seed();
    const { body } = await makeModule().call('GET', `/projects/${shop.id}`);
    expect(body.options.aliases).toEqual([{ value: 'sh', label: 'sh' }]);
    expect(body.options.labels.map((o: { value: string }) => o.value)).toEqual(['state::production', 'team::blue']);
    expect(body.options.paths).toHaveLength(1);
    expect(body.options.paths[0].value).toBe(body.project.paths[0].path);
    // Only one path: no other path can become the main one.
    expect(body.options.otherPaths).toEqual([]);
    // A project cannot be its own parent.
    expect(body.options.parents.map((o: { value: string }) => o.value).sort()).toEqual([base.id, blog.id].sort());
    expect(body.forms.empty).toEqual({ ref: shop.id });
    expect(body.forms.rename).toEqual({ ref: shop.id, name: 'shop' });
    expect(body.forms.git).toEqual({ ref: shop.id, git: 'git@x:shop.git' });
    expect(body.forms.parent).toEqual({ ref: shop.id, parent: base.id });
  });

  it('does not offer a descendant as the parent (it would be a cycle)', async () => {
    const { base, shop } = await seed();
    const { body } = await makeModule().call('GET', `/projects/${base.id}`);
    expect(body.options.parents.map((o: { value: string }) => o.value)).not.toContain(shop.id);
    expect(body.project.descendantsCount).toBe(1);
  });

  it('404 with the closest names for an unknown reference', async () => {
    await seed();
    const { status, body } = await makeModule().call('GET', '/projects/shpo');
    expect(status).toBe(404);
    expect(body.error).toBe('PROJECT_NOT_FOUND');
    expect(body.message).toContain('shop');
  });

  it('404 that points to the trash for a removed project', async () => {
    const { blog } = await seed();
    await removeProject(world.registryDir, blog.id);
    const { status, body } = await makeModule().call('GET', `/projects/${blog.id}`);
    expect(status).toBe(404);
    expect(body.message).toContain('trash');
  });

  it('with inlineErrors an unknown project is data', async () => {
    const { status, body } = await makeModule().call('GET', '/projects/zzz?inlineErrors=true');
    expect(status).toBe(200);
    expect(body).toMatchObject({ failed: true, httpStatus: 404 });
  });
});

describe('GET /tree', () => {
  it('lists the hierarchy depth-first with a virtual parent', async () => {
    await seed();
    const { status, body } = await makeModule().call('GET', '/tree');
    expect(status).toBe(200);
    expect(body.rows.map((r: { name: string; depth: number }) => [r.name, r.depth])).toEqual([
      ['base', 0],
      ['shop', 1],
      ['blog', 0],
    ]);
    expect(body.rows[0]).toMatchObject({ virtual: true, virtualText: 'virtual' });
    expect(body.warnings).toEqual([]);
    expect(body.warningsText).toBe('');
  });

  it('survives a registry edited by hand: a parent that does not exist gives a root and a visible warning, never a crash or an empty page', async () => {
    const { blog } = await seed();
    const file = registryFilePath(world.registryDir);
    const registry = JSON.parse(readFileSync(file, 'utf8'));
    registry.projects.find((p: { id: string }) => p.id === blog.id).parent = 'deadbeef';
    writeFileSync(file, JSON.stringify(registry));
    const { status, body } = await makeModule().call('GET', '/tree');
    expect(status).toBe(200);
    expect(body.rows.map((r: { name: string }) => r.name).sort()).toEqual(['base', 'blog', 'shop']);
    expect(body.warnings.join(' ')).toContain('deadbeef');
    // The page shows the warnings as one text.
    expect(body.warningsText).toContain('deadbeef');
  });

  it('a registry file that is not JSON is said as such (an error with the file and the way out), not an empty tree', async () => {
    await seed();
    writeFileSync(registryFilePath(world.registryDir), '{ not json');
    const { status, body } = await makeModule().call('GET', '/tree');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.message).toContain('registry.json');
  });

  it('is empty for a registry that does not exist', async () => {
    expect((await makeModule().call('GET', '/tree')).body).toMatchObject({ rows: [], warnings: [] });
  });
});

describe('GET /deleted', () => {
  it('lists the removed projects with the date and the options of the restore form', async () => {
    const { base, shop } = await seed();
    await setParent(world.registryDir, shop.id, null);
    await removeProject(world.registryDir, base.id);
    const { status, body } = await makeModule().call('GET', '/deleted');
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.projects[0]).toMatchObject({ id: base.id, name: 'base', hasDeletedParent: false });
    expect(body.projects[0].deletedAt).toMatch(/^\d{4}-/);
    expect(body.options).toEqual([{ value: base.id, label: `base (${base.id})` }]);
  });

  it('says that the trash is empty', async () => {
    const { body } = await makeModule().call('GET', '/deleted');
    expect(body).toMatchObject({ count: 0, projects: [], emptyText: 'The trash is empty.' });
  });
});
