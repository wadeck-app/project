import { describe, expect, it, vi } from 'vitest';
import { type UpdaterDeps, runProjectUpdater } from './runProjectUpdater.js';

function makeDeps(overrides: Partial<UpdaterDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const writtenStates: unknown[] = [];
  const deps: UpdaterDeps = {
    env: {},
    configDir: '/cfg',
    version: '1.0.0',
    nodePath: 'node',
    npmRootGlobal: () => '/npm/root',
    runUpdater: vi.fn(async () => undefined),
    readCache: () => null,
    readState: () => null,
    cacheFile: '/cfg/update-cache.json',
    stateFile: '/cfg/update-state.json',
    writeState: (state) => writtenStates.push(state),
    now: () => 5000,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    ...overrides,
  };
  return { deps, out, err, writtenStates };
}

describe('runProjectUpdater', () => {
  it('verifies the update with the self-check of the global install and updates without a daemon', async () => {
    const { deps } = makeDeps();
    const code = await runProjectUpdater(deps);
    expect(code).toBe(0);
    expect(deps.env['UPDATER_SELF_CHECK_CMD']).toContain('cli self-check');
    const config = vi.mocked(deps.runUpdater).mock.calls[0]![0];
    expect(config).toMatchObject({ pkgName: '@wadeck-app/project-cli', configDir: '/cfg', currentVersion: '1.0.0', strategy: 'without-daemon' });
    await expect((config as { onUpdateAvailable: (v: string) => Promise<unknown> }).onUpdateAvailable('2')).resolves.toBe('apply-now');
  });

  it('keeps a self-check command given by the caller and does not look for npm', async () => {
    const npmRootGlobal = vi.fn(() => '/never');
    const { deps } = makeDeps({ env: { UPDATER_SELF_CHECK_CMD: 'custom check' }, npmRootGlobal });
    await runProjectUpdater(deps);
    expect(deps.env['UPDATER_SELF_CHECK_CMD']).toBe('custom check');
    expect(npmRootGlobal).not.toHaveBeenCalled();
  });

  it('fails loudly, updates nothing and records the failure for the next command when npm root -g fails', async () => {
    const { deps, err, writtenStates } = makeDeps({
      npmRootGlobal: () => {
        throw new Error('spawn npm ENOENT');
      },
    });
    const code = await runProjectUpdater(deps);
    expect(code).toBe(1);
    expect(deps.runUpdater).not.toHaveBeenCalled();
    expect(err.join('\n')).toMatch(/\[project-updater\] fatal: cannot find the global npm folder.*spawn npm ENOENT/s);
    expect(writtenStates).toEqual([{ status: 'failed', currentVersion: '1.0.0', error: expect.stringContaining('spawn npm ENOENT'), timestamp: 5000 }]);
  });

  it('prints what this run did only when the user asked for the update', async () => {
    const quiet = makeDeps();
    await runProjectUpdater(quiet.deps);
    expect(quiet.out).toEqual([]);
    const forced = makeDeps({ env: { UPDATER_FORCE: '1' }, readCache: () => ({ lastCheckedAt: 9000, latestVersion: '1.0.0' }) });
    await runProjectUpdater(forced.deps);
    expect(forced.out).toEqual(['[project-updater] current: 1.0.0', '[project-updater] latest:  1.0.0', '[project-updater] status:  up to date']);
  });

  it('reports a crash of the updater, with the outcome when forced, and exits 1', async () => {
    const { deps, out, err } = makeDeps({ env: { UPDATER_FORCE: '1' }, runUpdater: async () => Promise.reject(new Error('boom')) });
    const code = await runProjectUpdater(deps);
    expect(code).toBe(1);
    expect(err).toContain('[project-updater] fatal: Error: boom');
    expect(out).toHaveLength(3);
  });
});
