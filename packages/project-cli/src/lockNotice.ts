import type { LockOptions } from '@wadeck-app/project-sdk';
import type { Io } from './command.js';

/** Lock options for every registry mutation: a held lock is announced on stderr instead of waiting silently. */
export function lockOptions(io: Io): LockOptions {
  return {
    onWait: (info) => {
      const holder = info.pid === undefined ? 'an unknown process' : `pid ${info.pid}`;
      const age = `${Math.floor(info.ageMs / 1000)}s`;
      io.err(`waiting for the registry lock held by ${holder} (locked for ${age}${info.stale ? ', stale: taking it over' : ''})`);
    },
  };
}
