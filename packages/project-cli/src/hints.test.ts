import { HasChildrenError, LabelTakenError, MainPathError, NoProjectInScopeError } from '@wadeck-app/project-sdk';
import { describe, expect, it } from 'vitest';
import { hintFor } from './hints.js';

describe('hintFor', () => {
  it('suggests --recursive for a project with descendants, from the error data', () => {
    const error = new HasChildrenError('m', {
      project: { id: '00000001', name: 'base' },
      children: [
        { id: '00000002', name: 'a' },
        { id: '00000003', name: 'b' },
      ],
    });
    expect(hintFor(error)).toBe('use --recursive to remove base together with its 2 descendant(s): a, b');
  });

  it('suggests --new-main for the main path', () => {
    expect(hintFor(new MainPathError('m'))).toBe("pass --new-main <path> to choose the next main path, or run 'project paths main <path>' first");
  });

  it('prints the hint carried by NoProjectInScopeError as is', () => {
    const error = new NoProjectInScopeError('m', { cwd: '/x', registered: [], hint: 'pass a project reference, or register this folder with: project add "/x"' });
    expect(hintFor(error)).toBe('pass a project reference, or register this folder with: project add "/x"');
  });

  it('has nothing to add to other errors', () => {
    expect(hintFor(new LabelTakenError('m', { kind: 'name', label: 'x' }))).toBeUndefined();
  });
});
