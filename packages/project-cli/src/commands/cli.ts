import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { runSelfCheck } from '@wadeck-app/shared-cli';
import { devBuildRefusalMessage, isReleaseVersion } from '@wadeck-app/shared-cli/ReleaseVersion';
import { readChannelFromConfig } from '@wadeck-app/shared-cli/ChannelConfig';
import { cliLogsCommand, cliRollbackCommand, cliUpdateCommand, cliVersionCommand } from '@wadeck-app/shared-cli/CliMetaCommands';
import type { CommandOutput, PlainCommand } from '../command.js';
import { CliError } from '../errors.js';
import { PACKAGE_NAME, UPDATER_BUNDLE_NAME, ownBundlePath } from '../ownBundle.js';
import { selfChecks } from '../selfChecks.js';
import { currentVersion } from '../version.js';
import { registerCommand, unregisterCommand } from './appCore.js';

/** A repo-built CLI (a version CI did not stamp) must never replace or roll back the global install. */
function refuseDevBuild(): void {
  const version = currentVersion();
  if (!isReleaseVersion(version)) {
    throw new CliError(devBuildRefusalMessage('project', version));
  }
}

/** These commands write their own output (shared-cli): there is no result to print, in JSON mode neither. */
const PRINTED_BY_THE_COMMAND: CommandOutput = { json: undefined, lines: [] };

const versionCommand: PlainCommand = {
  name: 'cli version',
  summary: 'Show the installed version and the one available on the update channel',
  target: 'none',
  args: [],
  options: {},
  run: async (context) => {
    await cliVersionCommand(PACKAGE_NAME, currentVersion(), readChannelFromConfig(context.registryDir));
    return PRINTED_BY_THE_COMMAND;
  },
};

const updateCommand: PlainCommand = {
  name: 'cli update',
  summary: 'Update now, whatever the cache or autoUpdate say (the CLI also updates itself in the background)',
  target: 'none',
  args: [],
  options: {
    check: { type: 'boolean', description: 'Only show the available version, do not install it' },
    log: { type: 'boolean', description: "Print the update log (the updater writes to the same daily file as 'project cli logs')" },
  },
  run: async (context) => {
    if (context.options.flag('log')) {
      await cliLogsCommand(context.registryDir, { follow: false });
      return PRINTED_BY_THE_COMMAND;
    }
    if (context.options.flag('check')) {
      await cliVersionCommand(PACKAGE_NAME, currentVersion(), readChannelFromConfig(context.registryDir));
      return PRINTED_BY_THE_COMMAND;
    }
    refuseDevBuild();
    const updater = join(dirname(ownBundlePath()), UPDATER_BUNDLE_NAME);
    if (!existsSync(updater)) {
      throw new CliError(`updater bundle not found: ${updater} (a development build has none; build it with: npm run bundle)`);
    }
    try {
      await cliUpdateCommand(updater, PACKAGE_NAME);
    } catch (error) {
      throw new CliError(`update failed (${error instanceof Error ? error.message : String(error)}); see: project cli logs`);
    }
    return PRINTED_BY_THE_COMMAND;
  },
};

const rollbackCommand: PlainCommand = {
  name: 'cli rollback',
  summary: 'Reinstall the version that was installed before the last update',
  target: 'none',
  args: [],
  options: {},
  run: async (context) => {
    refuseDevBuild();
    await cliRollbackCommand(PACKAGE_NAME, context.registryDir);
    return PRINTED_BY_THE_COMMAND;
  },
};

const selfCheckCommand: PlainCommand = {
  name: 'cli self-check',
  summary: 'Check that this install works (the updater runs it on a new version before keeping it)',
  target: 'none',
  args: [],
  options: {},
  run: async () => {
    await runSelfCheck(selfChecks());
    return PRINTED_BY_THE_COMMAND;
  },
};

const logsCommand: PlainCommand = {
  name: 'cli logs',
  summary: "Print today's log: the invocations of the CLI and the updater entries",
  target: 'none',
  args: [],
  options: { follow: { type: 'boolean', description: 'Keep printing new lines' } },
  run: async (context) => {
    await cliLogsCommand(context.registryDir, { follow: context.options.flag('follow') });
    return PRINTED_BY_THE_COMMAND;
  },
};

export const CLI_COMMANDS: PlainCommand[] = [versionCommand, updateCommand, rollbackCommand, selfCheckCommand, logsCommand, registerCommand, unregisterCommand];
