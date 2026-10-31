import { addProject } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeAppCore, json } from './fakeAppCore.js';
import { type World, makeModule, makeWorld } from './testKit.js';

let world: World;
beforeEach(() => {
  world = makeWorld();
});
afterEach(() => {
  world.cleanup();
  delete process.env['APP_CORE_PORT'];
});

const panel = (title: string) => ({ title, count: 2, items: [{ label: 'Fix it', url: '/modules/task/tasks/a', subtitle: 'open' }, { label: 'Other', url: '/modules/task/tasks/b' }], moreUrl: '/modules/task/tasks?project=shop' });

describe('GET /projects/:ref/related', () => {
  it('asks the other modules about the project id (a name or alias is resolved first) and flattens the panels for the page', async () => {
    const shop = await addProject(world.registryDir, { name: 'shop', aliases: ['sh'] });
    const app = await fakeAppCore(['project', 'task'], { task: (_req, res) => json(res, 200, panel('Tasks')) });
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    const { status, body } = await makeModule().call('GET', '/projects/sh/related');
    expect(status).toBe(200);
    expect(app.calls).toEqual([`task:${shop.id}`]);
    expect(body.projectId).toBe(shop.id);
    expect(body.panels).toEqual([{ module: 'task', title: 'Tasks', count: 2, items: expect.any(Array), moreUrl: '/modules/task/tasks?project=shop' }]);
    expect(body.summary).toEqual([{ module: 'task', title: 'Tasks', countText: '2 recent items', noteText: '', seeAllText: 'See all', href: '/modules/task/tasks?project=shop' }]);
    expect(body.rows).toEqual([
      { module: 'task', panel: 'Tasks', label: 'Fix it', subtitle: 'open', href: '/modules/task/tasks/a' },
      { module: 'task', panel: 'Tasks', label: 'Other', subtitle: '', href: '/modules/task/tasks/b' },
    ]);
    expect(body.warnings).toEqual([]);
    expect(body.hasPanels).toBe(true);
  });

  it('renders the count with its label ("3 open") and says when the list is partial', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const app = await fakeAppCore(['task', 'flow'], {
      task: (_req, res) => json(res, 200, { title: 'Tasks', count: 3, countLabel: 'open', truncated: true, items: [{ label: 'a', url: '/modules/task/a' }], moreUrl: '/modules/task' }),
      flow: (_req, res) => json(res, 200, { title: 'Flows', items: [{ label: 'f', url: '/modules/flow/f' }] }),
    });
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    const { body } = await makeModule().call('GET', '/projects/shop/related');
    expect(body.summary).toEqual([
      { module: 'flow', title: 'Flows', countText: '1 item', noteText: '', seeAllText: '', href: '' },
      { module: 'task', title: 'Tasks', countText: '3 open', noteText: 'partial list', seeAllText: 'See all', href: '/modules/task' },
    ]);
  });

  it('never shows the bare count of a provider that sends what needs attention as count and recent history as items (flow, queue)', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const recent = Array.from({ length: 10 }, (_, i) => ({ label: `run ${i}`, url: `/modules/flow/executions/${i}` }));
    const app = await fakeAppCore(['flow'], { flow: (_req, res) => json(res, 200, { title: 'Flow executions', count: 0, items: recent, moreUrl: '/modules/flow/executions?project=shop' }) });
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    const { body } = await makeModule().call('GET', '/projects/shop/related');
    expect(body.summary).toEqual([{ module: 'flow', title: 'Flow executions', countText: '10 recent items', noteText: '', seeAllText: 'See all', href: '/modules/flow/executions?project=shop' }]);
  });

  it('does not ask again for a minute a module that said it has nothing for this project (negative cache)', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const app = await fakeAppCore(['task'], { task: (_req, res) => json(res, 409, {}) });
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    const module = makeModule();
    await module.call('GET', '/projects/shop/related');
    const second = await module.call('GET', '/projects/shop/related');
    expect(app.calls).toHaveLength(1);
    expect(second.body.warnings).toEqual([]);
  });

  it('shows the failure of a module as a warning with its name, next to the panels of the others', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const app = await fakeAppCore(['bad', 'task'], { bad: (_req, res) => json(res, 500, {}), task: (_req, res) => json(res, 200, panel('Tasks')) });
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    const { body } = await makeModule().call('GET', '/projects/shop/related');
    expect(body.panels.map((p: { module: string }) => p.module)).toEqual(['task']);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toEqual({ module: 'bad', text: expect.stringMatching(/^bad: .*status 500/) });
  });

  it('says there is nothing related when no module contributes', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const app = await fakeAppCore(['project', 'plain'], {});
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    const { body } = await makeModule().call('GET', '/projects/shop/related');
    expect(body).toMatchObject({ hasPanels: false, panels: [], rows: [], emptyText: expect.stringContaining('No other module') });
  });

  it('404 for an unknown project, without asking any module', async () => {
    const app = await fakeAppCore(['task'], { task: (_req, res) => json(res, 200, panel('Tasks')) });
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    const { status } = await makeModule().call('GET', '/projects/ghost/related');
    expect(status).toBe(404);
    expect(app.calls).toEqual([]);
  });

  it('with inlineErrors, an app-core that cannot be reached is data on the page (not a blank page), with the fix', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    const app = await fakeAppCore([], {});
    process.env['APP_CORE_PORT'] = new URL(app.baseUrl).port;
    await app.close();
    const { status, body } = await makeModule().call('GET', '/projects/shop/related?inlineErrors=true');
    expect(status).toBe(200);
    expect(body).toMatchObject({ failed: true, httpStatus: 502, errorText: expect.stringContaining('Check that app-core is running') });
  });

  it('a malformed APP_CORE_PORT is said, not replaced by another port', async () => {
    await addProject(world.registryDir, { name: 'shop' });
    process.env['APP_CORE_PORT'] = 'abc';
    const { status, body } = await makeModule().call('GET', '/projects/shop/related');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.message).toContain('APP_CORE_PORT');
  });
});
