import { tmpdir } from 'node:os';
import { relative } from 'node:path';
import { defaultRegistryDir } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type World, makeModule, makeWorld } from './testKit.js';

let world: World;
beforeEach(() => {
  world = makeWorld();
});
afterEach(() => world.cleanup());

// That the real folder is unchanged at the end of the run (every file, recursively, `app-module/` included) is checked by the guard of the whole
// run (test-support/guardRealConfig.ts, globalSetup): it fails the run, naming the path. These tests check what leads there.
describe('the tests never touch the real registry', () => {
  it('reads and writes a registry in a temp folder, not the one of the developer', () => {
    const real = process.env['PROJECT_TEST_REAL_CONFIG_DIR'];
    expect(real, 'the globalSetup guard must have recorded the real folder').toBeTruthy();
    const used = defaultRegistryDir(process.env);
    expect(used).not.toBe(real);
    expect(relative(tmpdir(), used).startsWith('..')).toBe(false);
  });

  it('the routes write there: a project added and removed through them is in the temp registry', async () => {
    const module = makeModule();
    await module.call('POST', '/projects', { body: { name: 'sandboxed' } });
    await module.call('DELETE', '/projects/sandboxed');
    expect((await module.call('GET', '/deleted')).body.count).toBe(1);
    expect(relative(tmpdir(), world.registryDir).startsWith('..')).toBe(false);
  });
});
