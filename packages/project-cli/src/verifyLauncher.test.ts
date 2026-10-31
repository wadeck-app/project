import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bashCommand, removeTempDir } from './testHelpers.js';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'scripts').replace(/\\/g, '/');
const isWin = process.platform === 'win32';
const lines = (text: string): string[] => text.trim().split(/\r?\n/);
const VERSION = '2026.10.26-001-abcdef12';

// The real bin launcher prints noise on stdout on its FIRST run (npm's output when it installs the platform package) before the answer of the command.
const NOISE = 'echo "added 1 package in 2s"; echo "";';

describe('the install and update checks against the noisy launcher (ci/scripts/verify-lib.sh)', () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'project-cli-verifylauncher-'));
  });
  afterEach(() => removeTempDir(work));

  const bash = (script: string, env: NodeJS.ProcessEnv = {}) =>
    spawnSync(bashCommand(), ['-c', `source ${scripts}/verify-lib.sh; ${script}`], {
      encoding: 'utf8',
      env: { ...process.env, VERIFY_ROOT: work.replace(/\\/g, '/'), ...env },
    });

  describe('installed_version', () => {
    it('is the version only, whatever the launcher printed on stdout before it, and the stderr of the launcher is not part of it', () => {
      const script = `isolate_env > /dev/null; project() { echo "project: platform package @wadeck-app/project-cli-win32-x64 missing -- installing..." >&2; ${NOISE} echo "${VERSION}"; }; echo "[$(installed_version)]"`;
      const result = bash(script);
      expect(result.status, result.stderr).toBe(0);
      expect(lines(result.stdout).pop()).toBe(`[${VERSION}]`);
    });

    it('takes the last non-empty line, ignores blank lines after it and carriage returns', () => {
      const result = bash(`isolate_env > /dev/null; project() { printf 'noise\\r\\n%s\\r\\n\\r\\n\\n' "${VERSION}"; }; echo "[$(installed_version)]"`);
      expect(lines(result.stdout).pop()).toBe(`[${VERSION}]`);
    });

    it('fails, saying the exit status and keeping the output for the diagnosis, when the command fails', () => {
      const result = bash('isolate_env > /dev/null; project() { echo "partial" ; echo "boom" >&2; return 3; }; installed_version');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('FAIL: project --version exited with status 3');
    });
  });

  describe('first_run (the warm-up)', () => {
    it('runs the command once under its own label and shows what it printed, so the noise is in the log and not in a comparison', () => {
      const result = bash(`isolate_env > /dev/null; project() { ${NOISE} echo "${VERSION}"; }; first_run`);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('==> first run: the launcher may install its platform package');
      expect(result.stdout + result.stderr).toContain('added 1 package in 2s');
    });

    it('fails when the first run fails', () => {
      const result = bash('isolate_env > /dev/null; project() { return 5; }; first_run');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('FAIL: the first run of project exited with status 5');
    });
  });

  describe('update_to', () => {
    it('retries while the registry still serves the old version (the dist-tag lags after a publish), then succeeds', () => {
      const script =
        'isolate_env > /dev/null; sleep() { :; }; calls=0; ' +
        'project() { case "$1" in cli) calls=$((calls+1));; --version) if [ "$calls" -ge 3 ]; then echo NEW; else echo OLD; fi;; esac; }; ' +
        'update_to NEW; echo "calls=$calls"';
      const result = bash(script);
      expect(result.status, result.stderr).toBe(0);
      expect(lines(result.stdout).pop()).toBe('calls=3');
    });

    it('gives up with the installed and the wanted version after six attempts', () => {
      const result = bash('isolate_env > /dev/null; sleep() { :; }; project() { case "$1" in cli) ;; --version) echo OLD;; esac; }; update_to NEW');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("FAIL: after 6 attempts the installed version is 'OLD', expected 'NEW'");
    });
  });

  describe('install_global', () => {
    it('retries a failing npm install and groups its output', () => {
      const script =
        'isolate_env > /dev/null; sleep() { :; }; n=0; npm() { n=$((n+1)); if [ "$n" -lt 3 ]; then echo "E404 not found" >&2; return 1; fi; echo "added 1 package"; }; install_global "@x/y@1"; echo "attempts=$n"';
      const result = bash(script, { GITHUB_ACTIONS: 'true', NPM_CONFIG_USERCONFIG: '/set/by/the/workflow' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('::group::npm install -g @x/y@1');
      expect(result.stdout).toContain('::endgroup::');
      expect(lines(result.stdout).pop()).toBe('attempts=3');
    });

    it('after six failures, fails with the last npm error in the message', () => {
      const result = bash('isolate_env > /dev/null; sleep() { :; }; npm() { echo "E404 package not found" >&2; return 1; }; install_global "@x/y@1"', {
        GITHUB_ACTIONS: 'true',
        NPM_CONFIG_USERCONFIG: '/set/by/the/workflow',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('FAIL: npm install -g @x/y@1 did not succeed after 6 attempts');
      expect(result.stdout).toMatch(/::error title=verify-install::.*E404 package not found/);
    });

    it('prints plain separators, not workflow commands, outside GitHub Actions', () => {
      const result = bash('isolate_env > /dev/null; npm() { echo ok; }; install_global "@x/y@1"', { GITHUB_ACTIONS: '', NPM_CONFIG_USERCONFIG: '/set/by/the/workflow' });
      expect(result.stdout).not.toContain('::group::');
      expect(result.stdout).toContain('--- npm install -g @x/y@1');
    });
  });

  describe('failure annotations (readable through the check-runs API without access to the logs)', () => {
    const annotation = (script: string, env: NodeJS.ProcessEnv = { GITHUB_ACTIONS: 'true' }) => {
      const result = bash(script, { NPM_CONFIG_USERCONFIG: '/set/by/the/workflow', ...env });
      const found = lines(result.stdout).filter((line) => line.startsWith('::error'));
      return { result, found };
    };

    it('is one ::error line titled verify-install, with newlines encoded as %0A and the last lines of the failing command', () => {
      const { result, found } = annotation(
        'isolate_env > /dev/null; printf "out1\\nout2\\n" > "$VERIFY_ROOT/last-stdout.txt"; printf "err1\\nerr2\\n" > "$VERIFY_ROOT/last-stderr.txt"; fail "version mismatch"',
      );
      expect(result.status).not.toBe(0);
      expect(found).toHaveLength(1);
      expect(found[0]).toBe('::error title=verify-install::FAIL: version mismatch%0A--- last stdout:%0Aout1%0Aout2%0A--- last stderr:%0Aerr1%0Aerr2');
    });

    it('encodes percent signs and carriage returns, so the message cannot break the workflow command', () => {
      const { found } = annotation('isolate_env > /dev/null; fail "100% sure"$\'\\r\\n\'"next"');
      expect(found[0]).toContain('100%25 sure');
      expect(found[0]).toContain('%0D%0A');
      expect(found).toHaveLength(1);
    });

    it('is truncated to about 1500 characters, keeping the beginning', () => {
      const { found } = annotation(`isolate_env > /dev/null; fail "start-$(head -c 4000 /dev/zero | tr '\\0' 'x')"`);
      expect(found[0]!.startsWith('::error title=verify-install::FAIL: start-xxx')).toBe(true);
      expect(found[0]!.length).toBeLessThan(1600);
    });

    it('keeps only the last 15 lines of the captured output', () => {
      const { found } = annotation('isolate_env > /dev/null; seq 1 40 > "$VERIFY_ROOT/last-stdout.txt"; fail "x"');
      expect(found[0]).toContain('%0A26%0A');
      expect(found[0]).toContain('%0A40');
      expect(found[0]).not.toContain('%0A25%0A');
    });

    it('is not emitted outside GitHub Actions', () => {
      const { result, found } = annotation('isolate_env > /dev/null; fail "x"', { GITHUB_ACTIONS: '' });
      expect(found).toEqual([]);
      expect(result.stderr).toContain('FAIL: x');
    });
  });

  describe('the isolated environment and npm authentication', () => {
    it('keeps the npm user config that npm itself reports when HOME is redirected, unless the workflow already set one', () => {
      const result = bash('unset NPM_CONFIG_USERCONFIG; npm() { if [ "$1 $2 $3" = "config get userconfig" ]; then echo /real/user/config; fi; }; isolate_env > /dev/null; echo "$NPM_CONFIG_USERCONFIG"', {
        NPM_CONFIG_USERCONFIG: '',
      });
      expect(lines(result.stdout).pop()).toBe('/real/user/config');
      const preset = bash('npm() { echo /should/not/be/asked; }; isolate_env > /dev/null; echo "$NPM_CONFIG_USERCONFIG"', { NPM_CONFIG_USERCONFIG: '/runner/temp/config' });
      expect(lines(preset.stdout).pop()).toBe('/runner/temp/config');
    });

    it.runIf(isWin)('puts the global bin folder in PATH in the POSIX form: a C:/ entry would be cut at the colon by bash', () => {
      const result = bash('isolate_env > /dev/null; echo "${PATH%%:*}"', { NPM_CONFIG_USERCONFIG: '/set/by/the/workflow' });
      // msys writes the temp folder as /tmp/...: any POSIX form is right, what matters is that it starts with a slash and has no drive colon.
      expect(lines(result.stdout).pop()).toMatch(/^\/.*npm-prefix$/);
    });
  });
});
