import { describe, expect, it } from 'vitest';
import { describeProject, isVirtual, mainPath } from './projects.js';
import { makeProject } from './testHelpers.js';

describe('describeProject', () => {
  it('is "name (id)"', () => {
    expect(describeProject(makeProject(1, { name: 'shop' }))).toBe('shop (00000001)');
  });
});

describe('mainPath', () => {
  it('is the path flagged main', () => {
    const project = makeProject(1, {
      paths: [
        { path: '/a', main: false },
        { path: '/b', main: true },
      ],
    });
    expect(mainPath(project)).toBe('/b');
  });

  it('is undefined for a virtual project', () => {
    expect(mainPath(makeProject(1))).toBeUndefined();
  });
});

describe('isVirtual', () => {
  it('is true for a project without path only', () => {
    expect(isVirtual(makeProject(1))).toBe(true);
    expect(isVirtual(makeProject(1, { paths: [{ path: '/a', main: true }] }))).toBe(false);
  });
});
