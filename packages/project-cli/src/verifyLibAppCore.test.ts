import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const slashes = (path: string): string => path.replace(/\\/g, '/');
const scripts = slashes(join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'scripts'));
const lines = (text: string): string[] => text.trim().split(/\r?\n/);

describe('ci/scripts/verify-lib.sh: helpers for the app-module check', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'project-cli-verifylib-appcore-'));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

  const bash = (script: string) =>
    spawnSync('bash', ['-c', `source ${scripts}/verify-lib.sh; ${script}`], { encoding: 'utf8', env: { ...process.env, VERIFY_ROOT: slashes(work) } });

  it('isolate_env gives app-core a config folder of its own in the temp root (a registration must never reach the real one)', () => {
    const result = bash('isolate_env; echo "$APP_CORE_CONFIG_DIR"; test -d "$APP_CORE_CONFIG_DIR" && echo exists');
    expect(result.status, result.stderr).toBe(0);
    const [dir, exists] = lines(result.stdout).slice(-2);
    expect(slashes(dir!).toLowerCase()).toContain(slashes(work).toLowerCase());
    expect(exists).toBe('exists');
  });

  it('pick_free_port exports a port where nothing listens (app-core is "not running")', async () => {
    const result = bash('pick_free_port; echo "$APP_CORE_PORT"');
    expect(result.status, result.stderr).toBe(0);
    const port = Number(lines(result.stdout).pop());
    expect(Number.isInteger(port) && port > 0 && port < 65536).toBe(true);
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
    });
  });

  it('assert_file passes on a file and fails naming it and what it is for otherwise', () => {
    writeFileSync(join(work, 'here.txt'), 'x');
    expect(bash(`assert_file "the manifest" "${slashes(work)}/here.txt"`).status).toBe(0);
    const missing = bash(`assert_file "the manifest" "${slashes(work)}/nope.txt"`);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('the manifest');
    expect(missing.stderr).toContain('nope.txt');
    expect(existsSync(join(work, 'nope.txt'))).toBe(false);
  });

  it('verify-install checks the packaged app-module and the DEFERRED outcome of register; verify-update checks that an update registered it', () => {
    const install = readFileSync(join(scripts, 'verify-install.sh'), 'utf8');
    expect(install).toContain('app-module/manifest.json');
    expect(install).toContain('pick_free_port');
    expect(install).toContain('cli register --json');
    expect(install).toContain('\\"status\\": \\"deferred\\"');
    expect(install).toContain('cli unregister');
    const update = readFileSync(join(scripts, 'verify-update.sh'), 'utf8');
    expect(update).toContain('pick_free_port');
    expect(update).toContain('modules/project.json');
    expect(update.indexOf('pick_free_port')).toBeLessThan(update.indexOf('update_to "$VERSION"'));
  });

  it('installed_package_dir is the folder of the global install', () => {
    const result = bash('npm() { echo /fake/root; }; export -f npm; installed_package_dir');
    expect(lines(result.stdout).pop()).toBe('/fake/root/@wadeck-app/project-cli');
  });
});
