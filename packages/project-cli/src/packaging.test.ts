import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isolatedCliEnv } from './testHelpers.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageDir, '..', '..');
const bundleDir = join(packageDir, 'dist-bundle');
const tsx = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const STAMP = '2099.1.2-003-deadbeef';

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runBundleScript(env: NodeJS.ProcessEnv): Outcome {
  const { BUNDLE_VERSION: _inherited, ...rest } = process.env;
  const result = spawnSync(tsx, ['ci/scripts/bundle.ts'], { cwd: packageDir, env: { ...rest, ...env }, encoding: 'utf8', shell: process.platform === 'win32' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Every bundle run schedules a background update after its command: it must never see the real config folder or the real global npm,
// and "autoUpdate: false" (written by isolatedCliEnv) keeps it from ever installing anything.
const sandbox = mkdtempSync(join(tmpdir(), 'project-cli-dist-env-'));
const isolatedEnv = isolatedCliEnv(sandbox);
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function node(script: string, args: string[]): Outcome {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...isolatedEnv } });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

// The steps below build and use the same dist-bundle folder: they run in order, in this file only.
describe('the bundle (ci/scripts/bundle.ts)', () => {
  it('refuses to build without BUNDLE_VERSION, and says so', () => {
    const missing = runBundleScript({});
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('BUNDLE_VERSION');
    expect(missing.stderr).toContain('refusing to build');
    const empty = runBundleScript({ BUNDLE_VERSION: '' });
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain('refusing to build');
  });

  it('builds project.cjs and project-updater.cjs stamped with the version', () => {
    const built = runBundleScript({ BUNDLE_VERSION: STAMP });
    expect(built.stderr).toBe('');
    expect(built.status).toBe(0);
    expect(existsSync(join(bundleDir, 'project.cjs'))).toBe(true);
    expect(existsSync(join(bundleDir, 'project-updater.cjs'))).toBe(true);
  });

  it('keeps the updater bundle under 500 KB', () => {
    expect(statSync(join(bundleDir, 'project-updater.cjs')).size).toBeLessThan(500 * 1024);
  });

  it('bundles the updater that journals an install and repairs an interrupted one (shared-updater 2026.10.25-019 or later)', () => {
    const updater = readFileSync(join(bundleDir, 'project-updater.cjs'), 'utf8');
    expect(updater, 'the repair of an interrupted "npm install -g" is missing: the lockfile pins an old shared-updater').toContain('repairInterruptedInstall');
    expect(updater).toContain("'applying'");
  });

  it('prints the stamped version, whatever the package.json says', () => {
    expect(node(join(bundleDir, 'project.cjs'), ['--version'])).toMatchObject({ status: 0, stdout: STAMP });
  });

  it('passes its own self-check, which is what the updater runs on a new install', () => {
    const result = node(join(bundleDir, 'project.cjs'), ['cli', 'self-check']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('[ok]');
    // The checks work in temporary registries: the registry of the user is not created.
    expect(existsSync(join(sandbox, 'xdg', 'project', 'registry.json'))).toBe(false);
  });
});

describe('the generated packages (ci/scripts/generate-platform-packages.sh, copy-binaries.sh)', () => {
  let root: string;

  function bash(script: string, args: string[] = []): Outcome {
    const result = spawnSync('bash', [join(packageDir, 'ci', 'scripts', script).replace(/\\/g, '/'), ...args], { cwd: root, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function packageJson(name: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) as Record<string, unknown>;
  }

  beforeAll(() => {
    for (const required of [join(bundleDir, 'project.cjs'), join(bundleDir, 'project-updater.cjs')]) {
      if (!existsSync(required)) {
        throw new Error(`${required} is missing: the bundle step above must have built it`);
      }
    }
    // A fake repository root: the scripts work on paths relative to it, as in CI. The Go launchers are replaced by small files.
    root = mkdtempSync(join(tmpdir(), 'project-cli-dist-'));
    const cli = join(root, 'packages', 'project-cli');
    mkdirSync(join(cli, 'launcher-go', 'dist'), { recursive: true });
    for (const launcher of ['project_windows_release.exe', 'project_darwin_arm64_release', 'project_darwin_amd64_release']) {
      writeFileSync(join(cli, 'launcher-go', 'dist', launcher), `fake ${launcher}`);
    }
    cpSync(bundleDir, join(cli, 'dist-bundle'), { recursive: true });
    cpSync(join(packageDir, 'README.md'), join(cli, 'README.md'));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('generates the dist package under the published name, and the 3 platform packages', () => {
    const generated = bash('generate-platform-packages.sh', ['project']);
    expect(generated.status, generated.stderr).toBe(0);
    expect(packageJson('project-cli-dist')).toMatchObject({
      name: '@wadeck-app/project-cli',
      bin: { project: './bin/project.js' },
      optionalDependencies: {
        '@wadeck-app/project-cli-win32-x64': expect.any(String),
        '@wadeck-app/project-cli-darwin-arm64': expect.any(String),
        '@wadeck-app/project-cli-darwin-x64': expect.any(String),
      },
    });
    expect(packageJson('project-cli-dist')).not.toHaveProperty('private', true);
    expect(packageJson('project-cli-dist')).not.toHaveProperty('dependencies');
    expect(packageJson('project-cli-win32-x64')).toMatchObject({ name: '@wadeck-app/project-cli-win32-x64', os: ['win32'], cpu: ['x64'], files: ['project.exe'] });
    expect(packageJson('project-cli-darwin-arm64')).toMatchObject({ name: '@wadeck-app/project-cli-darwin-arm64', os: ['darwin'], cpu: ['arm64'], files: ['project'] });
    expect(packageJson('project-cli-darwin-x64')).toMatchObject({ name: '@wadeck-app/project-cli-darwin-x64', os: ['darwin'], cpu: ['x64'], files: ['project'] });
  });

  it('generates a launcher that starts with a node shebang and names the platform packages', () => {
    const launcher = readFileSync(join(root, 'packages', 'project-cli-dist', 'bin', 'project.js'), 'utf8');
    expect(launcher.split('\n')[0]).toBe('#!/usr/bin/env node');
    expect(launcher).toContain('@wadeck-app/project-cli-win32-x64');
    expect(launcher).toContain("'project.cjs'");
    expect(launcher).not.toContain('{{');
  });

  it('copies the launchers, the bundles and the README into the packages', () => {
    const copied = bash('copy-binaries.sh');
    expect(copied.status, copied.stderr).toBe(0);
    for (const file of ['project-cli-win32-x64/project.exe', 'project-cli-darwin-arm64/project', 'project-cli-darwin-x64/project']) {
      expect(existsSync(join(root, 'packages', file)), file).toBe(true);
    }
  });

  it('publishes exactly the launcher, the two bundles, the README and the manifest in the dist package', () => {
    const dist = join(root, 'packages', 'project-cli-dist');
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: dist, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const files = (JSON.parse(output) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path).sort();
    expect(files).toEqual(['README.md', 'bin/project.js', 'package.json', 'project-updater.cjs', 'project.cjs']);
  });

  it('runs from the generated layout and prints the stamped version', () => {
    const result = node(join(root, 'packages', 'project-cli-dist', 'project.cjs'), ['--version']);
    expect(result).toMatchObject({ status: 0, stdout: STAMP });
  });
});
