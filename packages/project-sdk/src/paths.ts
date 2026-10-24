import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { InvalidPathError } from './errors.js';

const isWindows = process.platform === 'win32';
const LONG_PATH_PREFIX = '\\\\?\\';

/**
 * Canonical stored form of a path: absolute, forward slashes, no trailing separator (except a root),
 * uppercase drive letter and no `\\?\` prefix on Windows. A relative path is resolved against `base`, default: the process cwd.
 */
export function normalizePath(input: string, base?: string): string {
  let text = input;
  if (isWindows && text.startsWith(LONG_PATH_PREFIX)) {
    text = text.slice(LONG_PATH_PREFIX.length);
  }
  let result = base === undefined ? resolve(text) : resolve(base, text);
  if (isWindows) {
    result = result.replace(/\\/g, '/').replace(/^[a-z]:/, (drive) => drive.toUpperCase());
  }
  return result.length > 1 && result.endsWith('/') && !/^[A-Z]:\/$/.test(result) ? result.slice(0, -1) : result;
}

/** Comparison key of a path: normalized, lowercased on Windows (case-insensitive filesystem). */
export function pathKey(input: string, base?: string): string {
  const normalized = normalizePath(input, base);
  return isWindows ? normalized.toLowerCase() : normalized;
}

/** True when `childKey` is `parentKey` or lies below it, respecting segment boundaries. Both must be keys. */
export function isSameOrInside(parentKey: string, childKey: string): boolean {
  if (childKey === parentKey) {
    return true;
  }
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  return childKey.startsWith(prefix);
}

/** Throws InvalidPathError unless the path exists and is a directory. */
export function assertDirectory(path: string): void {
  let isDirectory: boolean;
  try {
    isDirectory = statSync(path).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new InvalidPathError(`path ${path} does not exist; create the folder first or register an existing directory`, path);
    }
    throw new InvalidPathError(`path ${path} cannot be read (${code ?? String(error)}); check its permissions`, path);
  }
  if (!isDirectory) {
    throw new InvalidPathError(`path ${path} is not a directory; register the folder that contains it`, path);
  }
}
