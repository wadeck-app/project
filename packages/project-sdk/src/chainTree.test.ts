import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAncestors, getChildren, getDescendants } from './chain.js';
import { DanglingParentError, ParentCycleError } from './errors.js';
import { addProject } from './projectMutations.js';
import { loadRegistry } from './registryIo.js';
import { removeProject } from './removal.js';
import { type Workspace, makeProject, makeRegistry, makeWorkspace } from './testHelpers.js';

// root (virtual) -> a -> a1 -> a1x ; root -> b ; other (no relation)
const root = makeProject(1, { name: 'root' });
const a = makeProject(2, { name: 'a', parent: root.id });
const b = makeProject(3, { name: 'b', parent: root.id });
const a1 = makeProject(4, { name: 'a1', parent: a.id });
const a1x = makeProject(5, { name: 'a1x', parent: a1.id });
const other = makeProject(6, { name: 'other' });
// Registry order is deliberately not tree order.
const registry = makeRegistry(a1x, other, b, root, a1, a);

const names = (projects: { name: string }[]) => projects.map((p) => p.name);

describe('getChildren', () => {
  it('returns the direct children only, in registry order', () => {
    expect(names(getChildren(registry, root))).toEqual(['b', 'a']);
    expect(names(getChildren(registry, a))).toEqual(['a1']);
  });

  it('is empty for a leaf and for an unrelated project', () => {
    expect(getChildren(registry, a1x)).toEqual([]);
    expect(getChildren(registry, other)).toEqual([]);
  });
});

describe('getDescendants', () => {
  it('walks breadth-first and leaves the project itself out', () => {
    expect(names(getDescendants(registry, root))).toEqual(['b', 'a', 'a1', 'a1x']);
    expect(names(getDescendants(registry, a))).toEqual(['a1', 'a1x']);
  });

  it('is empty for a leaf', () => {
    expect(getDescendants(registry, a1x)).toEqual([]);
  });

  it('lists every level before the next one (breadth-first), whatever the registry order', () => {
    const deep = makeProject(10, { name: 'deep', parent: a1.id });
    const c = makeProject(11, { name: 'c', parent: root.id });
    expect(names(getDescendants(makeRegistry(deep, a1, c, root, a), root))).toEqual(['c', 'a', 'a1', 'deep']);
  });

  it('never loops on a corrupted registry with a cycle, and never returns the project itself', () => {
    const x = makeProject(20, { name: 'x' });
    const y = makeProject(21, { name: 'y', parent: x.id });
    const z = makeProject(22, { name: 'z', parent: y.id });
    x.parent = z.id;
    const cyclic = makeRegistry(x, y, z);
    expect(names(getDescendants(cyclic, x))).toEqual(['y', 'z']);
    expect(names(getDescendants(cyclic, z))).toEqual(['x', 'y']);
  });

  it('a project whose parent is not in the registry is simply not reached', () => {
    const orphan = makeProject(30, { name: 'orphan', parent: 'deadbeef' });
    expect(names(getDescendants(makeRegistry(root, a, orphan), root))).toEqual(['a']);
  });
});

describe('getAncestors', () => {
  it('is the parent first, up to the root, without the project', () => {
    expect(names(getAncestors(registry, a1x))).toEqual(['a1', 'a', 'root']);
    expect(names(getAncestors(registry, b))).toEqual(['root']);
  });

  it('is empty for a root', () => {
    expect(getAncestors(registry, root)).toEqual([]);
    expect(getAncestors(registry, other)).toEqual([]);
  });

  it('fails like getChain on a dangling parent and on a cycle', () => {
    const orphan = makeProject(30, { name: 'orphan', parent: 'deadbeef' });
    expect(() => getAncestors(makeRegistry(orphan), orphan)).toThrow(DanglingParentError);
    const x = makeProject(20, { name: 'x' });
    const y = makeProject(21, { name: 'y', parent: x.id });
    x.parent = y.id;
    expect(() => getAncestors(makeRegistry(x, y), x)).toThrow(ParentCycleError);
  });
});

describe('with a registry written by the SDK', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });
  afterEach(() => ws.cleanup());

  it('a virtual parent has children and descendants; a removed project is not in them, and its subtree neither', async () => {
    await addProject(ws.registryDir, { name: 'base' });
    await addProject(ws.registryDir, { name: 'mid', parent: 'base' });
    await addProject(ws.registryDir, { name: 'leaf', parent: 'mid' });
    await addProject(ws.registryDir, { name: 'side', parent: 'base' });
    const live = () => loadRegistry(ws.registryDir);
    const base = () => live().projects.find((p) => p.name === 'base')!;
    expect(names(getChildren(live(), base()))).toEqual(['mid', 'side']);
    expect(names(getDescendants(live(), base()))).toEqual(['mid', 'side', 'leaf']);
    await removeProject(ws.registryDir, 'mid', { recursive: true });
    expect(names(getChildren(live(), base()))).toEqual(['side']);
    expect(names(getDescendants(live(), base()))).toEqual(['side']);
  });
});
