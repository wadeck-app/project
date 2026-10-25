import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

const meta = vi.hoisted(() => ({
  cliVersionCommand: vi.fn(async () => undefined),
  cliUpdateCommand: vi.fn(async () => undefined),
  cliRollbackCommand: vi.fn(async () => undefined),
  cliLogsCommand: vi.fn(async () => undefined),
}));
const selfCheck = vi.hoisted(() => ({ runSelfCheck: vi.fn(async () => undefined) }));

vi.mock('@wadeck-app/shared-cli/CliMetaCommands', () => ({ ...meta, warnUnknownArgs: vi.fn() }));
vi.mock('@wadeck-app/shared-cli', async (importOriginal) => ({ ...(await importOriginal<object>()), runSelfCheck: selfCheck.runSelfCheck }));

const PKG = '@wadeck-app/project-cli';

describe('project cli ...', () => {
  let h: Harness;
  let bundleDir: string;

  beforeEach(() => {
    h = makeHarness();
    bundleDir = mkdtempSync(join(tmpdir(), 'project-cli-bundle-'));
    // The launcher tells the CLI where its own bundle is; the updater sits next to it.
    vi.stubEnv('LAUNCHER_BUNDLE_OVERRIDE', join(bundleDir, 'project.cjs'));
    // These commands only run on a stamped release (see the development build guard below).
    vi.stubGlobal('__PROJECT_CLI_VERSION__', '2026.10.25-019-97c1ee11');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(bundleDir, { recursive: true, force: true });
    h.cleanup();
  });

  it('version: shows the installed and the available version for the configured channel', async () => {
    mkdirSync(h.registryDir, { recursive: true });
    writeFileSync(join(h.registryDir, 'config.yml'), 'channel: breaking-edge\n');
    const result = await h.cli(['cli', 'version']);
    expect(result).toMatchObject({ code: 0, out: '' });
    expect(meta.cliVersionCommand).toHaveBeenCalledWith(PKG, expect.stringMatching(/^\d+\.\d+\.\d+/), 'breaking-edge');
  });

  it('update --check: only shows the available version', async () => {
    await h.cli(['cli', 'update', '--check']);
    expect(meta.cliVersionCommand).toHaveBeenCalledTimes(1);
    expect(meta.cliUpdateCommand).not.toHaveBeenCalled();
  });

  it('update: runs the updater bundle that sits next to the CLI bundle', async () => {
    writeFileSync(join(bundleDir, 'project-updater.cjs'), '');
    const result = await h.cli(['cli', 'update']);
    expect(result.code).toBe(0);
    expect(meta.cliUpdateCommand).toHaveBeenCalledWith(join(bundleDir, 'project-updater.cjs'), PKG);
  });

  it('update: fails loudly, saying where it looked, when there is no updater bundle (dev build)', async () => {
    const result = await h.cli(['cli', 'update']);
    expect(result.code).toBe(1);
    expect(result.err).toContain(`error: updater bundle not found: ${join(bundleDir, 'project-updater.cjs')}`);
    expect(result.err).toContain('npm run bundle');
    expect(meta.cliUpdateCommand).not.toHaveBeenCalled();
  });

  it('update: turns a failing updater into an error that points at the logs', async () => {
    writeFileSync(join(bundleDir, 'project-updater.cjs'), '');
    meta.cliUpdateCommand.mockRejectedValueOnce(new Error('Updater exited with code 1'));
    const result = await h.cli(['cli', 'update']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('error: update failed (Updater exited with code 1); see: project cli logs');
  });

  it('rollback: reinstalls the previous version recorded in the config folder', async () => {
    await h.cli(['cli', 'rollback']);
    expect(meta.cliRollbackCommand).toHaveBeenCalledWith(PKG, h.registryDir);
  });

  it('logs: prints the logs of the config folder, following them with --follow', async () => {
    await h.cli(['cli', 'logs']);
    await h.cli(['cli', 'logs', '--follow']);
    expect(meta.cliLogsCommand.mock.calls).toEqual([
      [h.registryDir, { follow: false }],
      [h.registryDir, { follow: true }],
    ]);
  });

  it('self-check: runs the checks of the install', async () => {
    await h.cli(['cli', 'self-check']);
    expect(selfCheck.runSelfCheck).toHaveBeenCalledTimes(1);
    expect(vi.mocked(selfCheck.runSelfCheck).mock.calls[0]![0]).toHaveLength(3);
  });

  it('prints nothing more with --json: these commands write their own output', async () => {
    const result = await h.cli(['cli', 'logs', '--json']);
    expect(result).toMatchObject({ code: 0, out: '' });
  });

  it('needs a subcommand', async () => {
    const result = await h.cli(['cli']);
    expect(result.code).toBe(2);
    expect(result.err).toContain("'cli' needs a subcommand: version, update, rollback, self-check, logs");
  });
});

describe('project cli update --log', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    vi.clearAllMocks();
    h.cleanup();
  });

  it("prints the update log: the updater writes to the same daily file as 'cli logs'", async () => {
    const result = await h.cli(['cli', 'update', '--log']);
    expect(result.code).toBe(0);
    expect(meta.cliLogsCommand).toHaveBeenCalledWith(h.registryDir, { follow: false });
    expect(meta.cliUpdateCommand).not.toHaveBeenCalled();
  });

  it('is described in the help of cli update', async () => {
    const result = await h.cli(['cli', 'update', '--help']);
    expect(result.out).toContain('--check');
    expect(result.out).toContain('--log');
  });
});

describe('project cli update / rollback in a development build', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    vi.clearAllMocks();
    h.cleanup();
  });

  it.each(['update', 'rollback'])('cli %s refuses, exit 1, and touches nothing', async (command) => {
    const result = await h.cli(['cli', command]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('error: this is a development build (version');
    expect(result.err).toContain(`'project cli ${command}' would replace the global install`);
    expect(result.err).toContain('npm i -g @wadeck-app/project-cli');
    expect(meta.cliUpdateCommand).not.toHaveBeenCalled();
    expect(meta.cliRollbackCommand).not.toHaveBeenCalled();
  });

  it('the read-only commands still work: version, update --check, update --log, logs, self-check', async () => {
    for (const argv of [['cli', 'version'], ['cli', 'update', '--check'], ['cli', 'update', '--log'], ['cli', 'logs']]) {
      expect((await h.cli(argv)).code, argv.join(' ')).toBe(0);
    }
  });
});
