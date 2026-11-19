import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addProject, registryFilePath } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type World, makeModule, makeWorld } from './testKit.js';

let world: World;
beforeEach(() => {
  world = makeWorld();
});
afterEach(() => world.cleanup());

interface Health {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

const health = async (): Promise<{ status: number; body: Health }> => makeModule().call('GET', '/health') as Promise<{ status: number; body: Health }>;
const check = (body: Health, name: string) => body.checks.find((c) => c.name === name);

describe('GET /health (the update test of app-core-cli)', () => {
  it('is ok for a machine that has no registry yet, and creates nothing', async () => {
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(check(body, 'registry')).toMatchObject({ ok: true, detail: expect.stringContaining('no registry yet') });
  });

  it('is ok for a valid registry and says how many projects it holds', async () => {
    await addProject(world.registryDir, { name: 'shop', path: world.folder('shop') });
    await addProject(world.registryDir, { name: 'blog', path: world.folder('blog') });
    const { body } = await health();
    expect(body.ok).toBe(true);
    expect(check(body, 'registry')).toMatchObject({ ok: true, detail: '2 projects' });
    expect(check(body, 'folders')).toMatchObject({ ok: true });
  });

  it('fails with the file to repair when registry.json is not valid JSON', async () => {
    await addProject(world.registryDir, { name: 'shop', path: world.folder('shop') });
    writeFileSync(registryFilePath(world.registryDir), '{ not json');
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(check(body, 'registry')).toMatchObject({ ok: false, detail: expect.stringContaining('registry.json') });
  });

  it('fails when two folders hold the data of one project, naming both (merge by hand)', async () => {
    const shop = await addProject(world.registryDir, { name: 'shop', path: world.folder('shop') });
    mkdirSync(join(world.registryDir, 'projects', shop.id), { recursive: true });
    mkdirSync(join(world.registryDir, 'projects', `${shop.id}-shop`), { recursive: true });
    const { body } = await health();
    expect(body.ok).toBe(false);
    expect(check(body, 'folders')).toMatchObject({ ok: false, detail: expect.stringContaining(`${shop.id}-shop`) });
  });

  it('writes nothing: no folder is created for a project that has none yet', async () => {
    const shop = await addProject(world.registryDir, { name: 'shop', path: world.folder('shop') });
    await health();
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(world.registryDir, 'projects', `${shop.id}-shop`))).toBe(false);
  });
});
