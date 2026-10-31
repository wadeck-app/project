import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { type Behavior, fakeAppCore, json } from './fakeAppCore.js';
import { RequestError } from './httpError.js';
import { collectRelated } from './related.js';

const panel = (title: string, extra: object = {}) => ({ title, count: 1, items: [{ label: 'one', url: '/modules/x/one' }], ...extra });

describe('collectRelated', () => {
  it('asks every other module about the project and returns the panels sorted by module id, with the fields of the contract', async () => {
    const app = await fakeAppCore(['task', 'project', 'queue'], {
      task: (_req, res) => json(res, 200, panel('Tasks', { count: 12, items: [{ label: 'Fix it', url: '/modules/task/tasks/a', subtitle: 'open' }], moreUrl: '/modules/task/tasks?project=shop', extra: 'dropped' })),
      queue: (_req, res) => json(res, 200, panel('Queues')),
    });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels).toEqual([
      { module: 'queue', title: 'Queues', count: 1, items: [{ label: 'one', url: '/modules/x/one' }] },
      { module: 'task', title: 'Tasks', count: 12, items: [{ label: 'Fix it', url: '/modules/task/tasks/a', subtitle: 'open' }], moreUrl: '/modules/task/tasks?project=shop' },
    ]);
    // The project module does not ask itself.
    expect(app.calls.sort()).toEqual(['queue:0000abcd', 'task:0000abcd']);
  });

  // Parallel means the three requests were in flight together: no limit on the elapsed time, a slow runner must not fail it.
  it('asks the modules in parallel (all three requests are in flight together)', async () => {
    let running = 0;
    let peak = 0;
    const slow: Behavior = (_req, res) => {
      running += 1;
      peak = Math.max(peak, running);
      setTimeout(() => {
        running -= 1;
        json(res, 200, panel('Slow'));
      }, 400);
    };
    const app = await fakeAppCore(['a', 'b', 'c'], { a: slow, b: slow, c: slow });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl, timeoutMs: 20_000 });
    expect(panels).toHaveLength(3);
    expect(peak).toBe(3);
  });

  it('omits a module that does not know the route (404): most modules have nothing to say about a project', async () => {
    const app = await fakeAppCore(['task', 'queue', 'plain'], { task: (_req, res) => json(res, 200, panel('Tasks')) });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels.map((p) => p.module)).toEqual(['task']);
  });

  // task answers 409 for a virtual project or a broken parent chain: the module cannot say anything about this project.
  it('omits a module that answers 409 (not applicable to this project) exactly like a 404, without a warning', async () => {
    const app = await fakeAppCore(['task', 'other', 'busy'], {
      task: (_req, res) => json(res, 409, { error: 'virtual project' }),
      other: (_req, res) => json(res, 200, panel('Other')),
      busy: (_req, res) => json(res, 503, {}),
    });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels.map((p) => [p.module, p.error === undefined ? 'panel' : 'warning'])).toEqual([
      ['busy', 'warning'],
      ['other', 'panel'],
    ]);
  });

  // flow answers an extra `project` field ({ name, removed, virtual }): the contract only reads title, count, items and moreUrl.
  it('ignores unknown fields of the answer and of the items (forward compatible) and keeps only the contract', async () => {
    const app = await fakeAppCore(['flow'], {
      flow: (_req, res) =>
        json(res, 200, {
          title: 'Flows',
          count: 2,
          items: [{ label: 'Nightly', subtitle: 'ok', url: '/modules/flow/flows/n', status: 'green' }],
          moreUrl: '/modules/flow/flows',
          project: { name: 'shop', removed: false, virtual: false },
        }),
    });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels).toEqual([{ module: 'flow', title: 'Flows', count: 2, items: [{ label: 'Nightly', subtitle: 'ok', url: '/modules/flow/flows/n' }], moreUrl: '/modules/flow/flows' }]);
  });

  it('still rejects a wrong type of a known field when unknown fields are present', async () => {
    const app = await fakeAppCore(['flow'], { flow: (_req, res) => json(res, 200, { title: 'Flows', items: [], count: 'two', project: { name: 'shop' } }) });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels).toEqual([{ module: 'flow', error: expect.stringContaining("'count' must be a whole number") }]);
  });

  it.each([400, 502])('keeps a %i (malformed id, unreadable registry) as a visible warning with the status', async (status) => {
    const app = await fakeAppCore(['flow'], { flow: (_req, res) => json(res, status, { error: 'x' }) });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels).toEqual([{ module: 'flow', error: expect.stringContaining(`status ${status}`) }]);
  });

  it('turns a failing module into a warning with the module and the reason, and keeps the others', async () => {
    const app = await fakeAppCore(['bad', 'task'], { bad: (_req, res) => json(res, 500, { error: 'boom' }), task: (_req, res) => json(res, 200, panel('Tasks')) });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels).toHaveLength(2);
    expect(panels[0]).toEqual({ module: 'bad', error: expect.stringContaining('status 500') });
    expect(panels[1]).toMatchObject({ module: 'task', title: 'Tasks' });
  });

  it('gives up on a module that does not answer in time, as a warning (it must not block the page)', async () => {
    const app = await fakeAppCore(['hang', 'task'], { hang: () => undefined, task: (_req, res) => json(res, 200, panel('Tasks')) });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl, timeoutMs: 1000 });
    expect(panels[0]).toEqual({ module: 'hang', error: expect.stringContaining('did not answer within 1000 ms') });
    expect(panels[1]).toMatchObject({ module: 'task' });
  });

  it('uses 2 seconds as the default time limit', async () => {
    const app = await fakeAppCore(['hang'], { hang: () => undefined });
    const run = collectRelated('0000abcd', { baseUrl: app.baseUrl });
    const early = await Promise.race([run, new Promise((resolve) => setTimeout(() => resolve('pending'), 700))]);
    expect(early).toBe('pending');
    const panels = await run;
    expect(panels[0]!.error).toContain('2000 ms');
  }, 10_000);

  it.each([
    ['not JSON', (res: ServerResponse) => res.end('<html>'), 'is not JSON'],
    ['an array', (res: ServerResponse) => json(res, 200, []), 'must be an object'],
    ['no title', (res: ServerResponse) => json(res, 200, { items: [] }), "'title' must be a non-empty text"],
    ['no items', (res: ServerResponse) => json(res, 200, { title: 'T' }), "'items' must be a list"],
    ['a bad count', (res: ServerResponse) => json(res, 200, { title: 'T', items: [], count: -1 }), "'count' must be a whole number"],
    ['an item without label', (res: ServerResponse) => json(res, 200, { title: 'T', items: [{ url: '/modules/x' }] }), "items[0].label must be a non-empty text"],
    ['an external url', (res: ServerResponse) => json(res, 200, { title: 'T', items: [{ label: 'x', url: 'https://evil.example/' }] }), "items[0].url must start with '/modules/'"],
    ['a protocol-relative url', (res: ServerResponse) => json(res, 200, { title: 'T', items: [{ label: 'x', url: '//evil.example/' }] }), "items[0].url must start with '/modules/'"],
    ['a script url', (res: ServerResponse) => json(res, 200, { title: 'T', items: [{ label: 'x', url: 'javascript:alert(1)' }] }), "items[0].url must start with '/modules/'"],
    ['an external moreUrl', (res: ServerResponse) => json(res, 200, { title: 'T', items: [], moreUrl: 'http://evil.example' }), "'moreUrl' must start with '/modules/'"],
    ['a bad subtitle', (res: ServerResponse) => json(res, 200, { title: 'T', items: [{ label: 'x', url: '/modules/x', subtitle: 3 }] }), 'items[0].subtitle must be a text'],
  ])('refuses an invalid answer (%s) as a warning that says what is wrong, never shows it', async (_name, answer, reason) => {
    const app = await fakeAppCore(['odd'], { odd: (_req, res) => answer(res) });
    const panels = await collectRelated('0000abcd', { baseUrl: app.baseUrl });
    expect(panels).toEqual([{ module: 'odd', error: expect.stringContaining(reason) }]);
  });

  it('says that app-core cannot be reached, and how to fix it', async () => {
    const app = await fakeAppCore([], {});
    const { baseUrl } = app;
    await app.close();
    await expect(collectRelated('0000abcd', { baseUrl, timeoutMs: 500 })).rejects.toThrow(RequestError);
    await expect(collectRelated('0000abcd', { baseUrl, timeoutMs: 500 })).rejects.toThrow(/cannot reach app-core at http:\/\/127\.0\.0\.1:\d+/);
  });

  it('is empty when no other module is installed', async () => {
    const app = await fakeAppCore(['project'], {});
    expect(await collectRelated('0000abcd', { baseUrl: app.baseUrl })).toEqual([]);
  });
});
