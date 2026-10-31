import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidPathError } from './errors.js';
import { assertDirectory, isSameOrInside, normalizePath, pathKey, toNativePath } from './paths.js';

const isWin = process.platform === 'win32';

describe('normalizePath', () => {
  it('makes relative paths absolute and drops trailing separators', () => {
    const result = normalizePath('some/dir/');
    expect(result.endsWith('/some/dir')).toBe(true);
    expect(result).not.toContain('\\');
  });

  it('collapses dot segments', () => {
    expect(normalizePath(join(tmpdir(), 'a', '..', 'b'))).toBe(normalizePath(join(tmpdir(), 'b')));
  });

  it.runIf(isWin)('uppercases the drive letter and uses forward slashes (win32)', () => {
    expect(normalizePath('c:\\Work\\Shop\\')).toBe('C:/Work/Shop');
  });

  it.runIf(isWin)('strips the long-path prefix (win32)', () => {
    expect(normalizePath('\\\\?\\c:\\Work\\Shop')).toBe('C:/Work/Shop');
  });

  it.runIf(isWin)('keeps the root of a drive (win32)', () => {
    expect(normalizePath('c:\\')).toBe('C:/');
  });

  it.runIf(isWin)('accepts forward slashes as input (win32)', () => {
    expect(normalizePath('c:/Work/Shop')).toBe('C:/Work/Shop');
  });

  it.runIf(!isWin)('keeps case and the root (posix)', () => {
    expect(normalizePath('/Work/Shop/')).toBe('/Work/Shop');
    expect(normalizePath('/')).toBe('/');
  });
});

describe('pathKey', () => {
  it.runIf(isWin)('is case-insensitive (win32)', () => {
    expect(pathKey('C:/Work/Shop')).toBe(pathKey('c:\\work\\SHOP\\'));
  });

  it.runIf(!isWin)('is case-sensitive (posix)', () => {
    expect(pathKey('/work/Shop')).not.toBe(pathKey('/work/shop'));
  });
});

describe('isSameOrInside', () => {
  const root = isWin ? 'C:/a' : '/a';

  it('accepts equal and descendant keys', () => {
    expect(isSameOrInside(pathKey(root), pathKey(root))).toBe(true);
    expect(isSameOrInside(pathKey(root), pathKey(`${root}/b/c`))).toBe(true);
  });

  it('respects segment boundaries', () => {
    expect(isSameOrInside(pathKey(`${root}/b`), pathKey(`${root}/bc`))).toBe(false);
  });

  it('rejects ancestors and siblings', () => {
    expect(isSameOrInside(pathKey(`${root}/b`), pathKey(root))).toBe(false);
    expect(isSameOrInside(pathKey(`${root}/b`), pathKey(`${root}/c`))).toBe(false);
  });

  it('handles a filesystem root as the ancestor', () => {
    const fsRoot = isWin ? 'C:/' : '/';
    expect(isSameOrInside(pathKey(fsRoot), pathKey(`${fsRoot}x`))).toBe(true);
  });
});

describe('assertDirectory', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-sdk-paths-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  it('accepts an existing directory', () => {
    mkdirSync(join(dir, 'ok'));
    expect(() => assertDirectory(join(dir, 'ok'))).not.toThrow();
  });

  it('refuses a missing path with an actionable message', () => {
    expect(() => assertDirectory(join(dir, 'missing'))).toThrow(InvalidPathError);
    expect(() => assertDirectory(join(dir, 'missing'))).toThrow(/does not exist.*create the folder/s);
  });

  it('refuses a file', () => {
    writeFileSync(join(dir, 'file.txt'), 'x');
    expect(() => assertDirectory(join(dir, 'file.txt'))).toThrow(/not a directory/);
  });
});

describe('base argument', () => {
  const base = isWin ? 'C:/base/dir' : '/base/dir';

  it('resolves a relative path against the base instead of the process cwd', () => {
    expect(normalizePath('sub/x', base)).toBe(`${base}/sub/x`);
    expect(normalizePath('../up', base)).toBe(isWin ? 'C:/base/up' : '/base/up');
  });

  it('ignores the base for an absolute path', () => {
    const absolute = isWin ? 'D:/other' : '/other';
    expect(normalizePath(absolute, base)).toBe(absolute);
  });

  it('is accepted by pathKey too', () => {
    expect(pathKey('sub', base)).toBe(pathKey(`${base}/sub`));
  });

  it('keeps defaulting to the process cwd', () => {
    expect(normalizePath('x')).toBe(normalizePath(join(process.cwd(), 'x')));
  });
});

describe('toNativePath', () => {
  it('shows backslashes on win32 and leaves the path alone elsewhere (the stored form always has forward slashes)', () => {
    expect(toNativePath('C:/Users/me/work/shop', 'win32')).toBe('C:\\Users\\me\\work\\shop');
    expect(toNativePath('C:/', 'win32')).toBe('C:\\');
    expect(toNativePath('/home/me/shop', 'linux')).toBe('/home/me/shop');
    expect(toNativePath('/Users/me/shop', 'darwin')).toBe('/Users/me/shop');
  });

  it('keeps the backslashes of a path that is already native, and an empty path', () => {
    expect(toNativePath('C:\\a\\b', 'win32')).toBe('C:\\a\\b');
    expect(toNativePath('', 'win32')).toBe('');
  });

  it('defaults to the platform it runs on', () => {
    expect(toNativePath('/a/b')).toBe(isWin ? '\\a\\b' : '/a/b');
  });
});
