import { describe, expect, it } from 'vitest';
import { AmbiguousReferenceError, ProjectNotFoundError } from './errors.js';
import { levenshtein, resolveReference } from './references.js';
import { makeProject, makeRegistry } from './testHelpers.js';

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['abc', '', 3],
    ['kitten', 'sitting', 3],
    ['shop', 'shpo', 2],
    ['flaw', 'lawn', 2],
  ])('distance(%j, %j) = %i', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
    expect(levenshtein(b, a)).toBe(expected);
  });
});

describe('resolveReference', () => {
  const shop = makeProject(0x3fa9c1d2, { name: 'shop', aliases: ['sh', 'store'] });
  const blog = makeProject(0x3fa9c2aa, { name: 'blog', aliases: ['bl'] });
  const docs = makeProject(0x0a1b2c3d, { name: 'docs' });
  const registry = makeRegistry(shop, blog, docs);

  it('resolves an exact name, case-insensitively and trimmed', () => {
    expect(resolveReference(registry, '  SHOP ')).toBe(shop);
  });

  it('resolves an alias', () => {
    expect(resolveReference(registry, 'store')).toBe(shop);
    expect(resolveReference(registry, 'bl')).toBe(blog);
  });

  it('resolves a full id', () => {
    expect(resolveReference(registry, '0a1b2c3d')).toBe(docs);
    expect(resolveReference(registry, '0A1B2C3D')).toBe(docs);
  });

  it('resolves a unique id prefix of at least 4 chars', () => {
    expect(resolveReference(registry, '0a1b')).toBe(docs);
    expect(resolveReference(registry, '3fa9c1')).toBe(shop);
  });

  it('does not use prefixes shorter than 4 chars', () => {
    expect(() => resolveReference(registry, '0a1')).toThrow(ProjectNotFoundError);
  });

  it('prefers an exact name or alias over an id prefix', () => {
    const tricky = makeProject(1, { name: 'p1', aliases: ['abcd-ish'] });
    const other = makeProject(0xabcdef01, { name: 'other' });
    expect(resolveReference(makeRegistry(tricky, other), 'abcd-ish')).toBe(tricky);
  });

  it('reports an ambiguous id prefix, listing the candidates', () => {
    const run = () => resolveReference(registry, '3fa9c');
    expect(run).toThrow(AmbiguousReferenceError);
    expect(run).toThrow(/shop \(3fa9c1d2\).*blog \(3fa9c2aa\)/s);
    expect(run).toThrow(/longer prefix/);
  });

  describe('not found', () => {
    it('suggests the closest names and aliases as text only', () => {
      const run = () => resolveReference(registry, 'shpo');
      expect(run).toThrow(ProjectNotFoundError);
      expect(run).toThrow(/did you mean:.*shop \(3fa9c1d2\)/);
      expect(run).toThrow(/nothing was selected/);
      expect(run).toThrow(/project list/);
    });

    it('never auto-selects, even with a single obvious suggestion', () => {
      expect(() => resolveReference(registry, 'blgo')).toThrow(ProjectNotFoundError);
    });

    it('lists at most 3 suggestions', () => {
      const many = makeRegistry(...['aaab', 'aaac', 'aaad', 'aaae', 'aaaf'].map((name, i) => makeProject(i + 1, { name })));
      const message = (() => {
        try {
          resolveReference(many, 'aaaa');
        } catch (error) {
          return (error as Error).message;
        }
        throw new Error('expected a ProjectNotFoundError');
      })();
      expect(message.match(/aaa[b-f]/g)).toHaveLength(3);
    });

    it('does not suggest labels that are too far', () => {
      const run = () => resolveReference(registry, 'zzzzzzzz');
      expect(run).toThrow(/no project matches 'zzzzzzzz'/);
      expect(run).not.toThrow(/did you mean/);
      expect(run).toThrow(/project list/);
    });

    it('scales the allowed distance with the length (max(2, floor(len/3)))', () => {
      const long = makeRegistry(makeProject(1, { name: 'abcdefghijkl' }));
      // 12 chars: allowed distance 4.
      expect(() => resolveReference(long, 'abcdefghwxyz')).toThrow(/did you mean: abcdefghijkl/);
      expect(() => resolveReference(long, 'abcdewxyzijk')).not.toThrow(/did you mean/);
    });

    it('handles an empty reference', () => {
      expect(() => resolveReference(registry, '  ')).toThrow(/empty/);
    });
  });
});
