import { describe, expect, it } from 'vitest';
import { AmbiguousReferenceError, InvalidQualifiedIdError, ProjectNotFoundError } from './errors.js';
import { formatQualifiedId, parseQualifiedId, resolveQualifiedId } from './qualifiedId.js';
import { makeProject, makeRegistry } from './testHelpers.js';

describe('formatQualifiedId', () => {
  it('is <project>/<id>', () => {
    expect(formatQualifiedId('3fa9c1d2', 'abc123')).toBe('3fa9c1d2/abc123');
  });

  it('refuses an empty part, and a / inside a part (a local id never contains one)', () => {
    expect(() => formatQualifiedId('', 'abc')).toThrow(InvalidQualifiedIdError);
    expect(() => formatQualifiedId('shop', '')).toThrow(InvalidQualifiedIdError);
    expect(() => formatQualifiedId('shop', 'a/b')).toThrow(/must not contain '\/'/);
    expect(() => formatQualifiedId('sh/op', 'abc')).toThrow(InvalidQualifiedIdError);
  });
});

describe('parseQualifiedId', () => {
  it('splits on the first slash', () => {
    expect(parseQualifiedId('shop/abc123')).toEqual({ project: 'shop', id: 'abc123' });
    expect(parseQualifiedId('3fa9c1d2/abc123')).toEqual({ project: '3fa9c1d2', id: 'abc123' });
  });

  it('has no project part without a slash', () => {
    const parsed = parseQualifiedId('abc123');
    expect(parsed).toEqual({ id: 'abc123' });
    expect(parsed).not.toHaveProperty('project');
  });

  it.each(['', '   ', '/abc', 'shop/', '/', 'a/b/c', 'shop//abc'])('refuses %j, showing the shape', (input) => {
    const run = () => parseQualifiedId(input);
    expect(run).toThrow(InvalidQualifiedIdError);
    expect(run).toThrow(/<project>\/<id>/);
  });

  it('carries a stable code, the input and the reason', () => {
    try {
      parseQualifiedId('a/b/c');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_QUALIFIED_ID', input: 'a/b/c', reason: expect.stringContaining('one') });
      return;
    }
    throw new Error('expected an error');
  });

  it('round-trips with formatQualifiedId', () => {
    expect(parseQualifiedId(formatQualifiedId('shop', 'abc'))).toEqual({ project: 'shop', id: 'abc' });
  });
});

describe('resolveQualifiedId', () => {
  const shop = makeProject(1, { name: 'shop', aliases: ['sh'] });
  const blog = makeProject(2, { name: 'blog' });
  const registry = makeRegistry(shop, blog);

  it('resolves the project part by id, name or alias, like resolveReference', () => {
    expect(resolveQualifiedId(registry, `${shop.id}/abc`)).toEqual({ project: shop, id: 'abc' });
    expect(resolveQualifiedId(registry, 'shop/abc')).toEqual({ project: shop, id: 'abc' });
    expect(resolveQualifiedId(registry, 'SH/abc')).toEqual({ project: shop, id: 'abc' });
  });

  it('uses the fallback project when the input has no project part, and ignores it when it has one', () => {
    expect(resolveQualifiedId(registry, 'abc', blog)).toEqual({ project: blog, id: 'abc' });
    expect(resolveQualifiedId(registry, 'shop/abc', blog)).toEqual({ project: shop, id: 'abc' });
  });

  it('fails clearly without project part and without fallback, showing how to write it', () => {
    const run = () => resolveQualifiedId(registry, 'abc');
    expect(run).toThrow(InvalidQualifiedIdError);
    expect(run).toThrow(/'abc' has no project part and no project is in scope; write <project>\/<id>/);
  });

  it('passes on the errors of the reference resolution, and of the syntax', () => {
    expect(() => resolveQualifiedId(registry, 'shpo/abc')).toThrow(ProjectNotFoundError);
    expect(() => resolveQualifiedId(makeRegistry(makeProject(0xabcd0001), makeProject(0xabcd0002)), 'abcd/x')).toThrow(AmbiguousReferenceError);
    expect(() => resolveQualifiedId(registry, 'a/b/c', blog)).toThrow(InvalidQualifiedIdError);
  });
});
