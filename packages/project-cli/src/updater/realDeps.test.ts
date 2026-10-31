import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDir } from '../testHelpers.js';
import { realUpdaterDeps } from './realDeps.js';
import { runProjectUpdater } from './runProjectUpdater.js';

const sdk = vi.hoisted(() => ({
  registerModule: vi.fn(),
  unregisterModule: vi.fn(),
  describeRegistration: vi.fn(),
}));
vi.mock('@wadeck-app/app-core-sdk/register', () => sdk);

/**
 * The updater with its REAL wiring (npm root -g run for real in a temp prefix, the real files, the real staged signal, the real log file) and
 * only the install itself replaced by a function that swaps the files like `npm install -g` does. The scenario of the regression: the user
 * registered the pages under 022, rolled back to 021, then updates to 022 again.
 */
const PKG = path.join('@wadeck-app', 'project-cli');
const OLD = '2026.10.31-021-8874470f';
const NEW = '2026.10.31-022-8a33bead';

describe('the updater with the real wiring, across a rollback', () => {
  let work: string;
  let globalRoot: string;
  let registryDir: string;
  let saved: Record<string, string | undefined>;
  let out: string[];
  let err: string[];

  const manifestFile = (): string => path.join(globalRoot, PKG, 'app-module', 'manifest.json');
  const install = (version: string): void => {
    fs.mkdirSync(path.dirname(manifestFile()), { recursive: true });
    fs.writeFileSync(manifestFile(), JSON.stringify({ version }));
  };
  const stage = (version: string): string => {
    const file = path.join(registryDir, 'app-module', version, 'manifest.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version }));
    return file;
  };
  const logText = (): string => {
    const dir = path.join(registryDir, 'logs');
    // The messages of the ndjson lines (a path in the raw file has its backslashes doubled).
    const lines = fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) : [];
    return lines
      .filter((line) => line.trim() !== '')
      .map((line) => (JSON.parse(line) as { msg: string }).msg)
      .join('\n');
  };

  const update = async () => {
    const real = realUpdaterDeps(process.env, registryDir, OLD);
    const deps = {
      ...real,
      env: { ...process.env, UPDATER_FORCE: '1', UPDATER_SELF_CHECK_CMD: 'unused' },
      // The install: swaps the files like npm does, without the network.
      runUpdater: async () => install(NEW),
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
    };
    return runProjectUpdater(deps);
  };

  beforeEach(() => {
    vi.resetAllMocks();
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'project-updater-real-'));
    registryDir = path.join(work, 'xdg', 'project');
    fs.mkdirSync(registryDir, { recursive: true });
    out = [];
    err = [];
    saved = { XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'], npm_config_prefix: process.env['npm_config_prefix'] };
    process.env['XDG_CONFIG_HOME'] = path.join(work, 'xdg');
    // A temp global prefix: `npm root -g` answers for it (with the line break npm prints), nothing of the real install is read.
    process.env['npm_config_prefix'] = path.join(work, 'prefix');
    fs.mkdirSync(process.env['npm_config_prefix'], { recursive: true });
    const root = fs.realpathSync.native(path.join(work, 'prefix'));
    globalRoot = process.platform === 'win32' ? path.join(root, 'node_modules') : path.join(root, 'lib', 'node_modules');
    sdk.describeRegistration.mockImplementation((outcome: { status: string }) => `app-core: ${outcome.status}`);
    sdk.registerModule.mockResolvedValue({ status: 'deferred' });
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeTempDir(work);
  });

  it('re-registers the pages when the user registered them under another version and rolled back (a staged copy of ANY version is the signal)', async () => {
    install(OLD);
    const staged = stage(NEW);
    expect(await update()).toBe(0);
    expect(sdk.registerModule).toHaveBeenCalledTimes(1);
    // The staged copy of the new version is reused: it is the file app-core will read.
    expect(fs.realpathSync.native(sdk.registerModule.mock.calls[0]![0].manifestPath)).toBe(fs.realpathSync.native(staged));
    expect(err.join('\n')).toContain(`re-registering the project pages (app-module ${OLD} -> ${NEW})`);
    expect(logText()).toContain('re-registering the project pages');
    expect(logText()).toContain('reregister-on-update:v1');
  });

  it('registers nothing, and says how to, when nothing was ever registered (no staged copy)', async () => {
    install(OLD);
    expect(await update()).toBe(0);
    expect(sdk.registerModule).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('not registered');
    expect(err.join('\n')).toContain('project cli register');
    expect(logText()).toContain('not registered');
  });

  it('leaves a line in the log file even when the app-module did not change', async () => {
    install(NEW);
    stage(NEW);
    const real = realUpdaterDeps(process.env, registryDir, NEW);
    await runProjectUpdater({ ...real, env: { ...process.env, UPDATER_SELF_CHECK_CMD: 'unused' }, runUpdater: async () => undefined, stdout: () => undefined, stderr: () => undefined });
    expect(logText()).toContain(`app-module is unchanged (${NEW})`);
  });

  it('says so in the log file, with the path, when no app-module is found at all (a wrong path hid for a release)', async () => {
    const real = realUpdaterDeps(process.env, registryDir, OLD);
    await runProjectUpdater({ ...real, env: { ...process.env, UPDATER_SELF_CHECK_CMD: 'unused' }, runUpdater: async () => undefined, stdout: () => undefined, stderr: () => undefined });
    expect(logText()).toContain('ships no app-module');
    expect(logText()).toContain(path.join('app-module', 'manifest.json'));
  });
});
