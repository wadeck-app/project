import type { Command } from '../command.js';
import { addCommand } from './add.js';
import { CLI_COMMANDS } from './cli.js';
import { aliasAddCommand, aliasRemoveCommand } from './alias.js';
import { gitClearCommand, gitSetCommand } from './git.js';
import { listCommand } from './list.js';
import { parentClearCommand, parentSetCommand } from './parent.js';
import { pathCommand } from './path.js';
import { pathsAddCommand, pathsMainCommand, pathsMoveCommand, pathsRemoveCommand } from './paths.js';
import { removeCommand } from './remove.js';
import { renameCommand } from './rename.js';
import { resolveCommand } from './resolve.js';
import { showCommand } from './show.js';

/** Order of the help output. */
export const COMMANDS: Command[] = [
  addCommand,
  listCommand,
  showCommand,
  pathCommand,
  resolveCommand,
  renameCommand,
  aliasAddCommand,
  aliasRemoveCommand,
  parentSetCommand,
  parentClearCommand,
  gitSetCommand,
  gitClearCommand,
  pathsAddCommand,
  pathsRemoveCommand,
  pathsMoveCommand,
  pathsMainCommand,
  removeCommand,
  ...CLI_COMMANDS,
];
