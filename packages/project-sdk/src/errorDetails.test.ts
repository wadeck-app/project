import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AmbiguousReferenceError,
  HasChildrenError,
  InvalidPathError,
  LabelTakenError,
  MainPathError,
  NoProjectInScopeError,
  ProjectNotFoundError,
  VirtualProjectError,
} from './errors.js';
import { assertDirectory, normalizePath } from './paths.js';
import { addPath, removePath } from './pathMutations.js';
import { addProject } from './projectMutations.js';
import { assertLabelsFree } from './labels.js';
import { resolveReference } from './references.js';
import { removeProject } from './removal.js';
import { requirePath, resolveScope } from './resolution.js';
import { makeProject, makeRegistry, makeWorkspace, type Workspace } from './testHelpers.js';

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

const shop = makeProject(1, { name: 'shop', aliases: ['sh'] });
const blog = makeProject(2, { name: 'blog' });
const registry = makeRegistry(shop, blog);

describe('structured data of the errors', () => {
  it('LabelTakenError tells the kind, the label and the owner', () => {
    const error = caught(() => assertLabelsFree(registry, [{ label: 'sh', kind: 'alias' }]));
    expect(error).toBeInstanceOf(LabelTakenError);
    expect(error).toMatchObject({ kind: 'alias', label: 'sh', owner: { id: '00000001', name: 'shop' } });
  });

  it('LabelTakenError has no owner when the label is requested twice', () => {
    const error = caught(() =>
      assertLabelsFree(registry, [
        { label: 'new', kind: 'name' },
        { label: 'new', kind: 'alias' },
      ]),
    ) as LabelTakenError;
    expect(error).toMatchObject({ kind: 'alias', label: 'new' });
    expect(error.owner).toBeUndefined();
  });

  it('NoProjectInScopeError tells the cwd and every registered name (not capped)', () => {
    const many = makeRegistry(...Array.from({ length: 12 }, (_, i) => makeProject(i + 1, { name: `n${i + 1}` })));
    const error = caught(() => resolveScope(many, { cwd: '/nowhere' })) as NoProjectInScopeError;
    expect(error).toBeInstanceOf(NoProjectInScopeError);
    expect(error.cwd.endsWith('/nowhere')).toBe(true);
    expect(error.registered).toHaveLength(12);
    expect(error.registered[11]).toBe('n12');
  });

  it('InvalidPathError tells the path', () => {
    const missing = process.platform === 'win32' ? 'C:/definitely/missing' : '/definitely/missing';
    const error = caught(() => assertDirectory(missing));
    expect(error).toBeInstanceOf(InvalidPathError);
    expect((error as InvalidPathError).path).toBe(missing);
  });

  it('AmbiguousReferenceError tells the reference and the candidates', () => {
    const [first, second] = [makeProject(0xabcd0001), makeProject(0xabcd0002)] as const;
    const ambiguous = makeRegistry(first, second);
    const error = caught(() => resolveReference(ambiguous, 'abcd')) as AmbiguousReferenceError;
    expect(error).toBeInstanceOf(AmbiguousReferenceError);
    expect(error.ref).toBe('abcd');
    expect(error.candidates).toEqual([
      { id: 'abcd0001', name: first.name },
      { id: 'abcd0002', name: second.name },
    ]);
  });

  it('ProjectNotFoundError tells the reference and the suggestions, structured', () => {
    const error = caught(() => resolveReference(registry, 'shpo')) as ProjectNotFoundError;
    expect(error).toBeInstanceOf(ProjectNotFoundError);
    expect(error.ref).toBe('shpo');
    expect(error.suggestions).toEqual([
      { text: 'sh', project: { id: '00000001', name: 'shop' } },
      { text: 'shop', project: { id: '00000001', name: 'shop' } },
    ]);
  });

  it('ProjectNotFoundError has no suggestions when nothing is close', () => {
    const error = caught(() => resolveReference(registry, 'zzzzzzzz')) as ProjectNotFoundError;
    expect(error.suggestions).toEqual([]);
  });

  describe('on disk', () => {
    let ws: Workspace;
    beforeEach(() => {
      ws = makeWorkspace();
    });
    afterEach(() => ws.cleanup());

    it('HasChildrenError tells the project and its descendants', async () => {
      const root = await addProject(ws.registryDir, { name: 'root' });
      const kid = await addProject(ws.registryDir, { name: 'kid', parent: 'root' });
      const grandkid = await addProject(ws.registryDir, { name: 'grandkid', parent: 'kid' });
      const error = (await removeProject(ws.registryDir, 'root').catch((e: unknown) => e)) as HasChildrenError;
      expect(error).toBeInstanceOf(HasChildrenError);
      expect(error.project).toEqual({ id: root.id, name: 'root' });
      expect(error.children).toEqual([
        { id: kid.id, name: 'kid' },
        { id: grandkid.id, name: 'grandkid' },
      ]);
    });

    it('InvalidPathError from a mutation tells the path', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      const error = (await addPath(ws.registryDir, 'shop', `${ws.dir('a')}/missing`).catch((e: unknown) => e)) as InvalidPathError;
      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.path).toBe(`${ws.dir('a')}/missing`);
    });

    it('the messages carry no API identifier or command-line flag', async () => {
      await addProject(ws.registryDir, { name: 'shop', path: ws.dir('a') });
      await addPath(ws.registryDir, 'shop', ws.dir('b'));
      await addProject(ws.registryDir, { name: 'kid', parent: 'shop' });
      const main = (await removePath(ws.registryDir, 'shop', ws.dir('a')).catch((e: unknown) => e)) as MainPathError;
      const children = (await removeProject(ws.registryDir, 'shop').catch((e: unknown) => e)) as HasChildrenError;
      const virtual = caught(() => requirePath({ project: makeProject(9, { name: 'v' }), source: 'flag', via: '--project' })) as VirtualProjectError;
      expect(main.message).toContain('main path');
      for (const error of [main, children, virtual]) {
        expect(error.message).not.toMatch(/newMain|--recursive|project path add/);
      }
    });
  });
});

describe('the message when no project is in scope', () => {
  const aliased = makeRegistry(makeProject(1, { name: 'shop', aliases: ['sh', 'store'] }), makeProject(2, { name: 'blog' }));

  it('lists the projects as name (alias a, b) and quotes the path of the suggested command', () => {
    const base = process.platform === 'win32' ? 'C:/my work' : '/my work';
    const error = caught(() => resolveScope(aliased, { cwd: base })) as NoProjectInScopeError;
    expect(error.message).toBe(`no project in scope for ${normalizePath(base)}. Registered: shop (alias sh, store), blog`);
    expect(error.message).not.toMatch(/--project|project add/);
    expect(error.hint).toBe(`pass a project reference, or register this folder with: project add "${normalizePath(base)}"`);
  });
});
