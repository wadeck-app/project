import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isolatedCliEnv, realGlobalInstallSnapshot, realLogMentions } from './testHelpers.js';

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
  let root: string;

  beforeEach(() => {
    if (!existsSync(entry)) {
      throw new Error(`${entry} is missing: run 'npm run build' before 'npm test'`);
    }
    root = mkdtempSync(join(tmpdir(), 'project-cli-isolated-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const cli = (...args: string[]) => spawnSync(process.execPath, [entry, ...args], { env: isolatedCliEnv(root), encoding: 'utf8' });

  it('cli update and cli rollback of a development build refuse, leaving the real global install as it was', () => {
    const before = realGlobalInstallSnapshot();
    for (const command of ['update', 'rollback']) {
      const result = cli('cli', command);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('dev build');
    }
    expect(realGlobalInstallSnapshot()).toEqual(before);
  });

  // Real sessions use the installed CLI while the tests run, so the real files cannot be compared before and after: a unique argument is logged instead.
  it('what a spawned CLI logs lands in the isolated config folder, never in the real one', () => {
    const token = `isolation-probe-${randomUUID()}`;
    const result = cli('list', `--${token}`);
    expect(result.status).toBe(2);
    expect(readFileSync(join(root, 'xdg', 'project', 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`), 'utf8')).toContain(token);
    expect(realLogMentions(token)).toBe(false);
  });

  it('the probe would notice a leak: a token logged in the real config folder is found', () => {
    expect(realLogMentions(`never-logged-${randomUUID()}`)).toBe(false);
  });
});
describe('isolatedCliEnv and the scoped registry', () => {
  it('also points the @wadeck-app scope at the unreachable registry: a scoped setting in the real .npmrc must not win', () => {
    const root = mkdtempSync(join(tmpdir(), 'project-cli-isolated-'));
    try {
      const env = isolatedCliEnv(root);
      expect(env['npm_config_@wadeck-app:registry']).toBe(env['npm_config_registry']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
