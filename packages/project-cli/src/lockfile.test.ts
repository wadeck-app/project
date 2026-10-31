import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const lockfile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package-lock.json');

/** The numbers of a CalVer version `YYYY.M.D-NNN-sha`: year, month, day, build. */
function calverNumbers(version: string): number[] {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-(\d+)-[0-9a-f]+$/.exec(version);
  if (match === null) {
    throw new Error(`'${version}' is not a CalVer version (YYYY.M.D-NNN-sha)`);
  }
  return match.slice(1, 5).map(Number);
}

/** True when version `a` is the same as or later than `b`. */
export function isAtLeast(a: string, b: string): boolean {
  const left = calverNumbers(a);
  const right = calverNumbers(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i]! !== right[i]!) {
      return left[i]! > right[i]!;
    }
  }
  return true;
}

function lockedVersion(name: string): string {
  const lock = JSON.parse(readFileSync(lockfile, 'utf8')) as { packages: Record<string, { version?: string }> };
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (version === undefined) {
    throw new Error(`${name} is not in ${lockfile}: run npm install`);
  }
  return version;
}

describe('isAtLeast', () => {
  it('compares CalVer versions by date then build, not as text', () => {
    expect(isAtLeast('2026.10.25-019-97c1ee11', '2026.10.25-019-97c1ee11')).toBe(true);
    expect(isAtLeast('2026.10.25-020-aaaaaaaa', '2026.10.25-019-97c1ee11')).toBe(true);
    expect(isAtLeast('2026.11.1-001-aaaaaaaa', '2026.10.25-019-97c1ee11')).toBe(true);
    expect(isAtLeast('2026.10.10-017-4e04d240', '2026.10.25-019-97c1ee11')).toBe(false);
    expect(isAtLeast('2026.9.30-999-aaaaaaaa', '2026.10.25-019-97c1ee11')).toBe(false);
  });

  it('refuses a version that is not CalVer', () => {
    expect(() => isAtLeast('1.0.0', '2026.10.25-019-97c1ee11')).toThrow(/not a CalVer version/);
  });
});

describe('package-lock.json', () => {
  // The lockfile wins over "latest" in package.json: `npm ci` installs exactly what it pins, and the updater bundled into the published CLI is built from it.
  it('pins a shared-updater that repairs an interrupted install (2026.10.25-020 or later)', () => {
    const locked = lockedVersion('@wadeck-app/shared-updater');
    expect(
      isAtLeast(locked, '2026.10.25-020-6cb52900'),
      `package-lock.json pins @wadeck-app/shared-updater ${locked}: older versions leave the global CLI uninstalled when the updater is killed inside "npm install -g" ` +
        '(019 repairs an interrupted install, 020 also stops an orphaned npm child). Refresh it with: npm update @wadeck-app/shared-updater, and commit package-lock.json',
    ).toBe(true);
  });
});

describe('package-lock.json and the dev-build guard', () => {
  it('pins a shared-cli with the ReleaseVersion guard that accepts npm-style CalVer (2026.10.25-044 or later)', () => {
    const locked = lockedVersion('@wadeck-app/shared-cli');
    expect(
      isAtLeast(locked, '2026.10.25-044-51609e11'),
      `package-lock.json pins @wadeck-app/shared-cli ${locked}: older versions have no ReleaseVersion guard (a repo-built CLI could start the updater and replace the real global install) or reject unpadded month/day versions. ` +
        'Refresh it with: npm update @wadeck-app/shared-cli, and commit package-lock.json',
    ).toBe(true);
  });
});

describe('package-lock.json and the optional contributions of app-core', () => {
  const MINIMUM = '2026.10.31-141-a31f1e63';

  // The project module lists task, queue and flow in `optionalRequires` (never `requires`): an older app-core-cli does not know the key (check and package refuse the manifest),
  // an older app-core-sdk does not type it, and the server of 2026.10.31-140 has the feature but not the tooling (check/package of -140 are not usable).
  it.each(['@wadeck-app/app-core-cli', '@wadeck-app/app-core-sdk'])('pins %s with `optionalRequires` (2026.10.31-141 or later)', (name) => {
    const locked = lockedVersion(name);
    expect(
      isAtLeast(locked, MINIMUM),
      `package-lock.json pins ${name} ${locked}: manifest.json of the project module uses "optionalRequires", which needs ${MINIMUM} or later (the earlier 2026.10.31-140 has the server only). ` +
        `Refresh it with: npm update @wadeck-app/app-core-cli @wadeck-app/app-core-sdk, and commit package-lock.json`,
    ).toBe(true);
  });
});
