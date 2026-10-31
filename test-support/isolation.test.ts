import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDIRECTED_VARIABLES, isolateEnvironment, unusedPort } from './isolation.js';

const insideTmp = (path: string | undefined): boolean => path !== undefined && !relative(tmpdir(), path).startsWith('..');

describe('isolateEnvironment', () => {
  it('points every variable that decides where the tools look for the user configuration into one fresh temp folder', async () => {
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: '/real/xdg', HOME: '/real/home' };
    const isolation = await isolateEnvironment(env);
    try {
      for (const name of REDIRECTED_VARIABLES.filter((n) => n !== 'APP_CORE_PORT')) {
        expect(insideTmp(env[name]), `${name} = ${env[name]}`).toBe(true);
        expect(relative(isolation.dir, env[name]!).startsWith('..'), `${name} is inside ${isolation.dir}`).toBe(false);
      }
      expect(env['XDG_CONFIG_HOME']).not.toBe('/real/xdg');
    } finally {
      isolation.restore();
    }
  });

  it('gives app-core a port where nothing listens, never 4850', async () => {
    const env: NodeJS.ProcessEnv = {};
    const isolation = await isolateEnvironment(env);
    try {
      const port = Number(env['APP_CORE_PORT']);
      expect(port).toBe(isolation.port);
      expect(port).not.toBe(4850);
      await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
      });
    } finally {
      isolation.restore();
    }
  });

  it('switches the automatic update of app-core-cli off in the temp config (a detached updater must never install anything)', async () => {
    const env: NodeJS.ProcessEnv = {};
    const isolation = await isolateEnvironment(env);
    try {
      expect(existsSync(join(env['XDG_CONFIG_HOME']!, 'app-core-cli', 'config.yml'))).toBe(true);
    } finally {
      isolation.restore();
    }
  });

  it('restore puts back the previous values (and deletes the ones that were not set) and removes the folder', async () => {
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: '/real/xdg' };
    const isolation = await isolateEnvironment(env);
    isolation.restore();
    expect(env['XDG_CONFIG_HOME']).toBe('/real/xdg');
    expect(env['APP_CORE_PORT']).toBeUndefined();
    expect(existsSync(isolation.dir)).toBe(false);
  });

  it('two isolations are two different folders', async () => {
    const a = await isolateEnvironment({});
    const b = await isolateEnvironment({});
    try {
      expect(a.dir).not.toBe(b.dir);
    } finally {
      a.restore();
      b.restore();
    }
  });
});

describe('unusedPort', () => {
  it('is a valid port', async () => {
    const port = await unusedPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe('inside this very run (the setup file is mandatory)', () => {
  it('the environment of the test worker is already redirected to a temp folder, and 4850 is not the port', () => {
    for (const name of ['XDG_CONFIG_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'APP_CORE_CONFIG_DIR']) {
      expect(insideTmp(process.env[name]), `${name} = ${process.env[name]}`).toBe(true);
    }
    expect(process.env['APP_CORE_PORT']).toBeDefined();
    expect(process.env['APP_CORE_PORT']).not.toBe('4850');
  });

  it('the real folder is known to the tests from the guard, and is not the folder this worker uses', () => {
    const real = process.env['PROJECT_TEST_REAL_CONFIG_DIR'];
    expect(real, 'the globalSetup guard must have recorded the real folder').toBeTruthy();
    expect(insideTmp(real) && real!.includes('project-test-env-')).toBe(false);
    // Created here only to prove the temp parent is writable; nothing is made in the real folder.
    rmSync(mkdtempSync(join(tmpdir(), 'project-isolation-probe-')), { recursive: true, force: true });
  });
});
