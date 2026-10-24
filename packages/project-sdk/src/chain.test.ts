import { describe, expect, it } from 'vitest';
import { getChain } from './chain.js';
import { DanglingParentError, ParentCycleError } from './errors.js';
import { makeProject, makeRegistry } from './testHelpers.js';

describe('getChain', () => {
  it('returns only the project when it has no parent', () => {
    const a = makeProject(1);
    expect(getChain(makeRegistry(a), a)).toEqual([a]);
  });

  it('orders projects root-first, ending with the project', () => {
    const root = makeProject(1);
    const mid = makeProject(2, { parent: root.id });
    const leaf = makeProject(3, { parent: mid.id });
    expect(getChain(makeRegistry(leaf, root, mid), leaf).map((p) => p.name)).toEqual(['p1', 'p2', 'p3']);
  });

  it('fails on a dangling parent, naming the project and the missing id', () => {
    const a = makeProject(1, { parent: 'deadbeef' });
    const run = () => getChain(makeRegistry(a), a);
    expect(run).toThrow(DanglingParentError);
    expect(run).toThrow(/p1 \(00000001\).*deadbeef/s);
  });

  it('fails on a cycle, showing the loop', () => {
    const a = makeProject(1, { parent: '00000002' });
    const b = makeProject(2, { parent: '00000001' });
    const run = () => getChain(makeRegistry(a, b), a);
    expect(run).toThrow(ParentCycleError);
    expect(run).toThrow(/p1 -> p2 -> p1/);
  });

  it('fails on a project that is its own parent', () => {
    const a = makeProject(1, { parent: '00000001' });
    expect(() => getChain(makeRegistry(a), a)).toThrow(ParentCycleError);
  });
});
