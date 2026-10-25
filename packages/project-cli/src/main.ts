#!/usr/bin/env node
import { defaultRegistryDir } from '@wadeck-app/project-sdk';
import { UpdateManager } from '@wadeck-app/shared-cli';
import { showUpdateNotice } from './noticeGlue.js';
import { PACKAGE_NAME, UPDATER_BUNDLE_NAME, ownBundlePath } from './ownBundle.js';
import { run } from './run.js';
import { currentVersion } from './version.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // The updater keeps its state, cache and logs next to the registry.
  const configDir = defaultRegistryDir(process.env);
  const updates = new UpdateManager(PACKAGE_NAME, configDir);
  showUpdateNotice({
    configDir,
    argv,
    manager: updates,
    print: (line) => process.stderr.write(`${line}\n`),
    warn: (message) => process.stderr.write(`${message}\n`),
  });
  process.exitCode = await run(
    argv,
    {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
    process.env,
    process.cwd(),
  );
  // After every command, a detached background run looks for a newer version (never for a development build, and a no-op in a build without updater bundle).
  updates.scheduleBackgroundUpdate(ownBundlePath(), UPDATER_BUNDLE_NAME, currentVersion());
}

void main();
