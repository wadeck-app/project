#!/usr/bin/env node

/**
 * Builds the Go launcher binaries (windows/amd64, darwin/arm64, darwin/amd64) with the build.sh of
 * @wadeck-app/singleton-daemon-kit, the shared source of the launcher (nothing of it is copied here).
 * Usage: node ci/scripts/build-launcher.mjs   (needs go and bash in the PATH)
 * Output: launcher-go/dist/project_<os>_..._release
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ciDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(ciDir, '..', 'launcher-go', 'dist');
const config = path.join(ciDir, 'launcher-project.config.json');

// require.resolve follows the workspace hoisting of node_modules.
const kitPackage = createRequire(import.meta.url).resolve('@wadeck-app/singleton-daemon-kit/package.json');
const buildScript = path.join(path.dirname(kitPackage), 'go-launcher', 'build.sh');
if (!existsSync(buildScript)) {
  throw new Error(`build.sh not found at ${buildScript}: reinstall @wadeck-app/singleton-daemon-kit (npm ci)`);
}

mkdirSync(outDir, { recursive: true });
const toUnix = (p) => p.replace(/\\/g, '/');
console.log('Building the project launchers...');
execFileSync('bash', [toUnix(buildScript), toUnix(config), toUnix(outDir)], { stdio: 'inherit', windowsHide: true });
