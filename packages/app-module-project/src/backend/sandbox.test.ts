import { existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { defaultRegistryDir } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type World, makeModule, makeWorld } from './testKit.js';

// Same fingerprint as vitest.setup.ts: the json files of the real registry folder, with their time and size.
function fingerprint(dir: string): string {
  if (!existsSync(dir)) {
    return 'absent';
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `${name}:${statSync(join(dir, name)).mtimeMs}:${statSync(join(dir, name)).size}`)
    .join('|');
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});
afterEach(() => world.cleanup());

describe('the tests never touch the real registry', () => {
  it('reads and writes a registry in a temp folder, not the one of the developer', () => {
    const real = process.env['PROJECT_TEST_REAL_REGISTRY_DIR'];
    expect(real, 'vitest.setup.ts must record the real registry folder').toBeTruthy();
    const used = defaultRegistryDir(process.env);
    expect(used).not.toBe(real);
    expect(relative(tmpdir(), used).startsWith('..')).toBe(false);
  });

  it('after writes through the routes, the files of the real registry folder are as they were at the start of the run', async () => {
    const real = process.env['PROJECT_TEST_REAL_REGISTRY_DIR']!;
    const module = makeModule();
    await module.call('POST', '/projects', { body: { name: 'sandboxed' } });
    await module.call('DELETE', '/projects/sandboxed');
    expect((await module.call('GET', '/deleted')).body.count).toBe(1);
    expect(fingerprint(real)).toBe(process.env['PROJECT_TEST_REAL_REGISTRY_FINGERPRINT']);
  });
});
