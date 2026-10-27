import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script used by the CI, no declaration file
import { previousVersion } from '../ci/scripts/previous-version.mjs';

describe('previousVersion', () => {
  const versions = ['2026.10.24-004-aaaaaaaa', '2026.10.25-019-bbbbbbbb', '2026.10.9-100-cccccccc', '2026.10.25-020-dddddddd', '2026.11.1-001-eeeeeeee'];

  it('is the published version just before the given one, in date then build order, not in array order', () => {
    expect(previousVersion(versions, '2026.10.25-020-dddddddd')).toBe('2026.10.25-019-bbbbbbbb');
    expect(previousVersion(versions, '2026.10.25-019-bbbbbbbb')).toBe('2026.10.24-004-aaaaaaaa');
    expect(previousVersion(versions, '2026.11.1-001-eeeeeeee')).toBe('2026.10.25-020-dddddddd');
    expect(previousVersion(versions, '2026.10.24-004-aaaaaaaa')).toBe('2026.10.9-100-cccccccc');
  });

  it('compares numbers, not text: 2026.10.9 comes before 2026.10.24', () => {
    expect(previousVersion(['2026.10.24-004-aaaaaaaa', '2026.10.9-100-cccccccc'], '2026.10.24-004-aaaaaaaa')).toBe('2026.10.9-100-cccccccc');
  });

  it('is undefined when there is none before it (first publication)', () => {
    expect(previousVersion(['2026.10.25-019-bbbbbbbb', '2026.10.26-001-cccccccc'], '2026.10.25-019-bbbbbbbb')).toBeUndefined();
    expect(previousVersion(['2026.10.25-019-bbbbbbbb'], '2026.10.25-019-bbbbbbbb')).toBeUndefined();
  });

  it('a version missing from the list (not visible yet) still has its predecessor: the latest one that is older', () => {
    expect(previousVersion(versions, '2030.1.1-001-ffffffff')).toBe('2026.11.1-001-eeeeeeee');
  });

  it('ignores versions that are not CalVer (0.0.1, other schemes)', () => {
    expect(previousVersion(['0.0.1', '1.2.3', '2026.10.24-004-aaaaaaaa', '2026.10.25-019-bbbbbbbb'], '2026.10.25-019-bbbbbbbb')).toBe('2026.10.24-004-aaaaaaaa');
  });

  it('accepts what npm view --json returns for a single version (a string, not an array)', () => {
    expect(previousVersion('2026.10.25-019-bbbbbbbb', '2026.10.25-019-bbbbbbbb')).toBeUndefined();
  });

  it('refuses a given version that is not CalVer: the caller made a mistake', () => {
    expect(() => previousVersion(versions, 'latest')).toThrow(/not a CalVer version/);
  });
});
