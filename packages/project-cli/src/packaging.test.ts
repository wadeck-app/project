import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = join(packageDir, '..', 'project-sdk');

interface PackageJson {
  version: string;
  bin: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageJson;

beforeAll(() => {
  // These tests check the BUILT package: a missing build is a failure, never a skip.
  for (const required of [join(packageDir, 'dist', 'main.js'), join(sdkDir, 'dist', 'esm', 'index.js')]) {
    if (!existsSync(required)) {
      throw new Error(`${required} is missing: run 'npm run build' before 'npm test' (the packaging tests use the compiled packages)`);
    }
  }
});

describe('the bin', () => {
  it('points package.json "bin.project" at a built file', () => {
    expect(manifest.bin).toEqual({ project: './dist/main.js' });
    expect(existsSync(join(packageDir, manifest.bin['project']!))).toBe(true);
  });

  it('starts with a node shebang, so npm can link it on every platform', () => {
    const first = readFileSync(join(packageDir, manifest.bin['project']!), 'utf8').split(/\r?\n/, 1)[0];
    expect(first).toBe('#!/usr/bin/env node');
  });
});

describe('npm pack', () => {
  interface PackedFile {
    path: string;
  }

  function packedFiles(): string[] {
    const output = execSync('npm pack --dry-run --json', { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return ((JSON.parse(output) as { files: PackedFile[] }[])[0]!.files).map((file) => file.path).sort();
  }

  it('publishes the manifest, the README and the compiled code, nothing else', () => {
    const files = packedFiles();
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');
    expect(files).toContain('dist/main.js');
    expect(files).toContain('dist/commands/add.js');
    const unexpected = files.filter((file) => !/^(package\.json|README\.md|dist\/.+\.js(\.map)?)$/.test(file));
    expect(unexpected, 'files that would be published by mistake').toEqual([]);
  });

  it('never publishes sources, tests, declarations or build info', () => {
    const files = packedFiles();
    expect(files.filter((file) => /^src\/|\.test\.|\.d\.ts$|tsbuildinfo|testHelpers/.test(file))).toEqual([]);
  });
});

describe('the packed layout', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'project-cli-pack-'));
    const tarball = JSON.parse(execSync(`npm pack --json --pack-destination "${root}"`, { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as {
      filename: string;
    }[];
    // Relative names with cwd: GNU tar reads "C:..." as a remote host.
    execSync(`tar -xzf "${tarball[0]!.filename}"`, { cwd: root });
    // The install of the SDK dependency is replaced by a link to the workspace build.
    mkdirSync(join(root, 'package', 'node_modules', '@wadeck-app'), { recursive: true });
    symlinkSync(sdkDir, join(root, 'package', 'node_modules', '@wadeck-app', 'project-sdk'), process.platform === 'win32' ? 'junction' : 'dir');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function runPacked(args: string): string {
    const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'xdg'), HOME: join(root, 'home'), USERPROFILE: join(root, 'home') };
    return execSync(`"${process.execPath}" "${join(root, 'package', 'dist', 'main.js')}" ${args}`, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  it('prints its own version from the package.json that was packed', () => {
    expect(runPacked('--version').trim()).toBe(manifest.version);
  });

  it('runs a command against an empty registry', () => {
    expect(runPacked('list --json').trim()).toBe('[]');
  });
});
