#!/usr/bin/env node
import { defaultRegistryDir } from '@wadeck-app/project-sdk';
import { UpdateManager } from '@wadeck-app/shared-cli';
import { PACKAGE_NAME, UPDATER_BUNDLE_NAME, ownBundlePath } from './ownBundle.js';
import { run } from './run.js';
import { updateNoticeLines } from './updateNotice.js';

async function main(): Promise<void> {
  // The updater keeps its state, cache and logs next to the registry.
  const updates = new UpdateManager(PACKAGE_NAME, defaultRegistryDir(process.env));
  for (const line of updateNoticeLines(updates.readAndClearState())) {
    process.stderr.write(`${line}\n`);
  }
  process.exitCode = await run(
    process.argv.slice(2),
    {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
    process.env,
    process.cwd(),
  );
  // After every command, a detached background run looks for a newer version (a no-op in a build without updater bundle).
  updates.scheduleBackgroundUpdate(ownBundlePath(), UPDATER_BUNDLE_NAME);
}

void main();
