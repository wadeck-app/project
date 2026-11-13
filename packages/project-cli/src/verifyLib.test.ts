import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bashCommand, removeTempDir } from './testHelpers.js';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'scripts').replace(/\\/g, '/');
const lines = (text: string): string[] => text.trim().split(/\r?\n/);

describe('ci/scripts/verify-lib.sh', () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'project-cli-verifylib-'));
  });
  afterEach(() => removeTempDir(work));

  const bash = (script: string) =>
    spawnSync(bashCommand(), ['-c', `source ${scripts}/verify-lib.sh; ${script}`], { encoding: 'utf8', env: { ...process.env, VERIFY_ROOT: work.replace(/\\/g, '/') } });

  it('isolates npm, the config folder and the home in the temp root, and switches the automatic update off', () => {
    const result = bash('isolate_env; echo "$npm_config_prefix"; echo "$XDG_CONFIG_HOME"; echo "$HOME"; echo "$USERPROFILE"; cat "$XDG_CONFIG_HOME/project/config.yml"');
    expect(result.status, result.stderr).toBe(0);
    const [prefix, xdg, home, profile, config] = lines(result.stdout).slice(-5);
    for (const value of [prefix, xdg, home, profile]) {
      expect(value!.replace(/\\/g, '/').toLowerCase(), value).toContain(work.replace(/\\/g, '/').toLowerCase());
    }
    expect(config).toBe('autoUpdate: false');
  });

  it('step prints a clear label, fail stops with the reason on stderr and a non-zero status', () => {
    expect(bash('step "install the package"').stdout).toContain('==> install the package');
    const failed = bash('fail "version mismatch"');
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('FAIL: version mismatch');
  });

  it('assert_equals passes on equal values and fails naming both otherwise', () => {
    expect(bash('assert_equals "the version" "1" "1"').status).toBe(0);
    const failed = bash('assert_equals "the version" "1" "2"');
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("the version: expected '1', got '2'");
  });

  it('assert_platform_package_installed passes when npm lists a platform package and fails loudly when none was installed', () => {
    const present = bash('npm() { echo /g/node_modules/@wadeck-app/project-cli; echo /g/node_modules/@wadeck-app/project-cli-linux-x64; }; export -f npm; assert_platform_package_installed');
    expect(present.status, present.stderr).toBe(0);
    const absent = bash('npm() { echo /g/node_modules/@wadeck-app/project-cli; }; export -f npm; assert_platform_package_installed');
    expect(absent.status).not.toBe(0);
    expect(absent.stderr).toContain('no platform package');
    expect(absent.stderr).toContain('optionalDependencies');
  });

  it('the scripts have a header saying how to run them locally', () => {
    for (const script of ['verify-install.sh', 'verify-update.sh', 'verify-lib.sh']) {
      const header = readFileSync(join(scripts, script), 'utf8').split('\n').slice(0, 12).join('\n');
      expect(header, script).toMatch(/Run locally/);
    }
  });
});
