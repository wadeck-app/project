import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppModuleVersion } from '../registerAfterUpdate.js';
import { type UpdaterDeps, runProjectUpdater } from './runProjectUpdater.js';

const MANIFEST = join('/npm/root', '@wadeck-app/project-cli', 'app-module', 'manifest.json');

/** The versions the installed app-module has, one per read: before the install, then after it. */
function makeDeps(versions: AppModuleVersion[], overrides: Partial<UpdaterDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const register = vi.fn(async (_manifestPath: string, log: (entry: { source: string; message: string }) => void) => log({ source: 'x', message: 'app-core: module "project" registered' }));
  const isRegistered = vi.fn(() => true);
  const notes: string[] = [];
  const readVersion = vi.fn(() => versions.shift() ?? ({ absent: true } as AppModuleVersion));
  const deps: UpdaterDeps = {
    env: {},
    configDir: '/cfg',
    version: '2026.10.25-019-97c1ee11',
    nodePath: 'node',
    npmRootGlobal: () => '/npm/root',
    runUpdater: vi.fn(async () => undefined),
    readCache: () => null,
    readState: () => null,
    cacheFile: '/cfg/update-cache.json',
    stateFile: '/cfg/update-state.json',
    writeState: () => undefined,
    now: () => 5000,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    appendLog: (_level, text) => notes.push(text),
    appModule: { readVersion, register, isRegistered },
    ...overrides,
  };
  return { deps, out, err, register, readVersion, isRegistered, notes };
}

describe('runProjectUpdater: the app-module after an update', () => {
  // `npm root -g` answers with a line break; the path of the manifest must not carry it (it did: the manifest was never found, nothing was
  // registered and nothing was said, in every real run).
  it.each([['LF', '\n'], ['CRLF', '\r\n']])('finds the manifest when npm root -g ends with %s', async (_name, ending) => {
    const { deps, register } = makeDeps([{ version: '1' }, { version: '2' }], { npmRootGlobal: () => `/npm/root${ending}` });
    await runProjectUpdater(deps);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]![0]).toBe(MANIFEST);
  });

  it('registers nothing when the module was never registered (the first registration is explicit) and says how to', async () => {
    const { deps, register, err } = makeDeps([{ absent: true }, { version: '2' }]);
    deps.appModule.isRegistered = () => false;
    expect(await runProjectUpdater(deps)).toBe(0);
    expect(register).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('project cli register');
  });

  it('reads whether the module was registered BEFORE the install (an install must not create the signal)', async () => {
    const order: string[] = [];
    const { deps } = makeDeps([{ version: '1' }, { version: '2' }], { runUpdater: vi.fn(async () => void order.push('install')) });
    deps.appModule.isRegistered = () => {
      order.push('signal');
      return true;
    };
    await runProjectUpdater(deps);
    expect(order).toEqual(['signal', 'install']);
  });

  it('tells app-core about the new pages when the installed app-module changed, and prints what app-core answered', async () => {
    const { deps, err, register } = makeDeps([{ version: '1' }, { version: '2' }]);
    expect(await runProjectUpdater(deps)).toBe(0);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]![0]).toBe(MANIFEST);
    expect(err).toContain('[project-updater] app-core: module "project" registered');
  });

  it('reads the version BEFORE the install replaces the files', async () => {
    const order: string[] = [];
    const { deps } = makeDeps([{ version: '1' }, { version: '2' }], {
      runUpdater: vi.fn(async () => void order.push('install')),
    });
    const original = deps.appModule.readVersion;
    deps.appModule.readVersion = (path) => {
      order.push('read');
      return original(path);
    };
    await runProjectUpdater(deps);
    expect(order).toEqual(['read', 'install', 'read']);
  });

  it('writes the decision to the log file too: re-registering, not registered, unchanged', async () => {
    const changed = makeDeps([{ version: '1' }, { version: '2' }]);
    await runProjectUpdater(changed.deps);
    expect(changed.notes.join('\n')).toContain('re-registering');
    const never = makeDeps([{ version: '1' }, { version: '2' }]);
    never.deps.appModule.isRegistered = () => false;
    await runProjectUpdater(never.deps);
    expect(never.notes.join('\n')).toContain('not registered');
    const same = makeDeps([{ version: '1' }, { version: '1' }]);
    await runProjectUpdater(same.deps);
    expect(same.notes.join('\n')).toContain('unchanged (1)');
  });

  it('says in the log file which behaviour this updater has (a CI check greps the bundle for it): reregister-on-update:v1', async () => {
    const { deps, notes } = makeDeps([{ version: '1' }, { version: '2' }]);
    await runProjectUpdater(deps);
    expect(notes.join('\n')).toContain('reregister-on-update:v1');
  });

  it('does nothing when the app-module did not change (already up to date, failed or rolled back update)', async () => {
    const { deps, register, out } = makeDeps([{ version: '1' }, { version: '1' }]);
    await runProjectUpdater(deps);
    expect(register).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('never fails the update: a registration that throws is reported on stderr with the manual fix, and the exit code stays 0', async () => {
    const { deps, err } = makeDeps([{ version: '1' }, { version: '2' }]);
    deps.appModule.register = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await runProjectUpdater(deps)).toBe(0);
    expect(err.join('\n')).toContain('app-core: registration after the update failed (boom)');
    expect(err.join('\n')).toContain('project cli register');
  });

  it('still registers when the updater crashed after the install replaced the files, and still exits 1 for the crash', async () => {
    const { deps, register, err } = makeDeps([{ version: '1' }, { version: '2' }], {
      runUpdater: vi.fn(async () => {
        throw new Error('self-check hung');
      }),
    });
    expect(await runProjectUpdater(deps)).toBe(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(err.join('\n')).toContain('self-check hung');
  });

  it('says so, with the fix, when the global npm folder is unknown (custom self-check command), and still updates', async () => {
    const { deps, register, err } = makeDeps([], {
      env: { UPDATER_SELF_CHECK_CMD: 'custom' },
      npmRootGlobal: () => {
        throw new Error('spawn npm ENOENT');
      },
    });
    expect(await runProjectUpdater(deps)).toBe(0);
    expect(deps.runUpdater).toHaveBeenCalledTimes(1);
    expect(register).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('not re-registering the app-module');
    expect(err.join('\n')).toContain('project cli register');
  });

  it('a development build neither updates nor registers', async () => {
    const { deps, register, readVersion } = makeDeps([], { version: '0.0.0-local' });
    expect(await runProjectUpdater(deps)).toBe(1);
    expect(register).not.toHaveBeenCalled();
    expect(readVersion).not.toHaveBeenCalled();
  });
});
