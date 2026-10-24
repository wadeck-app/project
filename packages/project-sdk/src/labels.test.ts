import { describe, expect, it } from 'vitest';
import { InvalidLabelError, LabelTakenError } from './errors.js';
import { assertLabelsFree, deriveName, findLabelOwner, normalizeLabel } from './labels.js';
import type { Project, Registry } from './types.js';

function project(overrides: Partial<Project>): Project {
  return { id: '3fa9c1d2', name: 'shop', aliases: ['sh'], paths: [], createdAt: '2026-10-24T00:00:00.000Z', ...overrides };
}

const registry: Registry = {
  schemaVersion: 1,
  projects: [project({}), project({ id: '0a1b2c3d', name: 'blog', aliases: ['bl'] })],
};

describe('normalizeLabel', () => {
  it('lowercases and trims valid input', () => {
    expect(normalizeLabel('  Shop-2.x_y ', 'name')).toBe('shop-2.x_y');
  });

  it.each(['', '1abc', '-abc', 'a b', 'a/b', 'é', '.x'])('rejects %j and shows the rule', (input) => {
    expect(() => normalizeLabel(input, 'name')).toThrow(InvalidLabelError);
    expect(() => normalizeLabel(input, 'alias')).toThrow(/\^\[a-z\]\[a-z0-9\._-\]\*\$/);
  });

  it('rejects more than 64 chars and accepts exactly 64', () => {
    expect(normalizeLabel('a'.repeat(64), 'name')).toHaveLength(64);
    expect(() => normalizeLabel('a'.repeat(65), 'name')).toThrow(/at most 64/);
  });

  it('rejects text that looks like an id', () => {
    expect(() => normalizeLabel('deadbeef', 'alias')).toThrow(/looks like a project id/);
    expect(() => normalizeLabel('DEADBEEF', 'alias')).toThrow(/looks like a project id/);
  });

  it('names the kind in the error', () => {
    expect(() => normalizeLabel('1x', 'alias')).toThrow(/alias '1x'/);
  });
});

describe('findLabelOwner', () => {
  it('matches names, aliases and ids case-insensitively', () => {
    expect(findLabelOwner(registry, 'SHOP')?.id).toBe('3fa9c1d2');
    expect(findLabelOwner(registry, 'bl')?.id).toBe('0a1b2c3d');
    expect(findLabelOwner(registry, '0A1B2C3D')?.id).toBe('0a1b2c3d');
    expect(findLabelOwner(registry, 'nope')).toBeUndefined();
  });
});

describe('assertLabelsFree', () => {
  it('accepts free labels', () => {
    expect(() => assertLabelsFree(registry, [{ label: 'new', kind: 'name' }, { label: 'n', kind: 'alias' }])).not.toThrow();
  });

  it.each([
    ['name of another project', 'blog'],
    ['alias of another project', 'bl'],
    ['id of another project', '0a1b2c3d'],
  ])('refuses a label equal to the %s, naming the owner', (_title, label) => {
    expect(() => assertLabelsFree(registry, [{ label, kind: 'alias' }])).toThrow(LabelTakenError);
    expect(() => assertLabelsFree(registry, [{ label, kind: 'alias' }])).toThrow(/blog \(0a1b2c3d\)/);
  });

  it('refuses an own entry too (name != own alias)', () => {
    expect(() => assertLabelsFree(registry, [{ label: 'sh', kind: 'name' }])).toThrow(/shop \(3fa9c1d2\)/);
  });

  it('refuses duplicates inside the requested labels', () => {
    expect(() =>
      assertLabelsFree(registry, [{ label: 'dup', kind: 'name' }, { label: 'dup', kind: 'alias' }]),
    ).toThrow(LabelTakenError);
  });
});

describe('deriveName', () => {
  it('is the lowercased base name of the folder', () => {
    expect(deriveName('/work/Shop-2')).toBe('shop-2');
    expect(deriveName('/work/shop/')).toBe('shop');
  });

  it('fails with the reason and the advice to pass an explicit name', () => {
    expect(() => deriveName('/work/My Shop')).toThrow(InvalidLabelError);
    expect(() => deriveName('/work/My Shop')).toThrow(/cannot derive a project name from the folder 'My Shop'.*must match.*pass an explicit name/);
  });

  it('fails for a folder name that looks like an id', () => {
    expect(() => deriveName('/work/deadbeef')).toThrow(/looks like a project id.*pass an explicit name/);
  });
});
