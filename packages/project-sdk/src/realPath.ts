import { realpathSync } from 'node:fs';
import { isSameOrInside, pathKey } from './paths.js';

/**
 * Key of the folder a path really is, with links, junctions and 8.3 short names resolved; undefined when the path cannot be resolved
 * (missing or unreadable folder), in which case callers compare the normalized key only.
 * Used for matching only: stored paths and `pathKey` stay purely string-based.
 */
export function realPathKey(path: string): string | undefined {
  try {
    return pathKey(realpathSync.native(path));
  } catch {
    // A folder that no longer exists is legitimate (a moved project); it is still matched by its normalized key.
    return undefined;
  }
}

/** A working directory prepared for matching: its normalized key now, its real key only if a comparison needs it. */
export interface CwdKeys {
  norm: string;
  real: () => string | undefined;
}

export function cwdKeys(cwd: string): CwdKeys {
  let resolved = false;
  let real: string | undefined;
  return {
    norm: pathKey(cwd),
    real: () => {
      if (!resolved) {
        real = realPathKey(cwd);
        resolved = true;
      }
      return real;
    },
  };
}

/**
 * Length of the key by which `registeredPath` is the cwd or one of its ancestors, or undefined when it is not.
 * Tried in order: both normalized, then the real cwd against the stored path, then both real paths.
 */
export function containmentLength(registeredPath: string, cwd: CwdKeys): number | undefined {
  const key = pathKey(registeredPath);
  if (isSameOrInside(key, cwd.norm)) {
    return key.length;
  }
  const realCwd = cwd.real();
  if (realCwd === undefined) {
    return undefined;
  }
  if (isSameOrInside(key, realCwd)) {
    return key.length;
  }
  const realRegistered = realPathKey(registeredPath);
  return realRegistered !== undefined && isSameOrInside(realRegistered, realCwd) ? realRegistered.length : undefined;
}
