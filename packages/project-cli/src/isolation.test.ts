import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isolatedCliEnv, realStateSnapshot } from './testHelpers.js';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');

describe('isolatedCliEnv', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'project-cli-isolated-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('points the registry, the home, the global npm prefix and the npm registry away from the real ones', () => {
    const env = isolatedCliEnv(root);
    expect(env['XDG_CONFIG_HOME']).toBe(join(root, 'xdg'));
    expect(env['HOME']).toBe(join(root, 'home'));
    expect(env['USERPROFILE']).toBe(join(root, 'home'));
    expect(env['npm_config_prefix']).toBe(join(root, 'npm-prefix'));
    expect(env['npm_config_registry']).toMatch(/^http:\/\/127\.0\.0\.1:9\/?$/);
    expect(env['PROJECT_PROJECT']).toBeUndefined();
  });

  it('writes autoUpdate: false in the config of the isolated registry, so even a stamped bundle started with it cannot install anything', () => {
    isolatedCliEnv(root);
    expect(readFileSync(join(root, 'xdg', 'project', 'config.yml'), 'utf8')).toContain('autoUpdate: false');
  });
});

// The incident this guards against: an updater killed inside `npm install -g` removed the real global CLI.
describe('the commands that update or roll back never touch the real installation or the real config folder', () => {
  it('cli update and cli rollback of a development build refuse, leaving the real global install and the real update files as they were', () => {
    if (!existsSync(entry)) {
      throw new Error(`${entry} is missing: run 'npm run build' before 'npm test'`);
    }
    const root = mkdtempSync(join(tmpdir(), 'project-cli-isolated-'));
    try {
      const before = realStateSnapshot();
      for (const command of ['update', 'rollback']) {
        const result = spawnSync(process.execPath, [entry, 'cli', command], { env: isolatedCliEnv(root), encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain('development build');
      }
      expect(realStateSnapshot()).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the snapshot covers the global install of the CLI and the update files of the real config folder', () => {
    const snapshot = realStateSnapshot();
    expect(Object.keys(snapshot)).toEqual(
      expect.arrayContaining(['global package.json', 'update-state.json', 'update-cache.json', 'update-notice-shown.json', 'update.lock']),
    );
  });
});
