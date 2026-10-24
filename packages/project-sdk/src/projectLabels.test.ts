import { describe, expect, it } from 'vitest';
import { InvalidProjectLabelError } from './errors.js';
import { filterProjects, formatLabel, hasLabel, labelsOf, matchesSelectors, normalizeProjectLabel, parseLabel, validateProjectLabels } from './projectLabels.js';
import { makeProject, makeRegistry } from './testHelpers.js';

describe('parseLabel', () => {
  it('parses key::value and bare values, lowercased and trimmed', () => {
    expect(parseLabel(' State::Production ')).toEqual({ key: 'state', value: 'production', text: 'state::production' });
    expect(parseLabel('Sandbox')).toEqual({ value: 'sandbox', text: 'sandbox' });
    expect(parseLabel('v1.2_x-y')).toEqual({ value: 'v1.2_x-y', text: 'v1.2_x-y' });
    expect(parseLabel('0abc')).toEqual({ value: '0abc', text: '0abc' });
  });

  it.each(['', '  ', '::', 'a::', '::b', 'a::b::c', '-a', 'a::-b', 'a b', 'a/b', 'é', '.x', 'a:b', 'a:::b'])('rejects %j and shows the rule', (input) => {
    const run = () => parseLabel(input);
    expect(run).toThrow(InvalidProjectLabelError);
    expect(run).toThrow(/key::value.*\^\[a-z0-9\]\[a-z0-9\._-\]\*\$/s);
  });

  it('carries the input and the reason', () => {
    try {
      parseLabel('a::b::c');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_PROJECT_LABEL', input: 'a::b::c', reason: expect.stringContaining('one') });
      return;
    }
    throw new Error('expected an error');
  });

  it('accepts 64 characters in the key and in the value, not 65', () => {
    const part = 'a'.repeat(64);
    expect(parseLabel(`${part}::${part}`).text).toBe(`${part}::${part}`);
    expect(() => parseLabel(`${part}a::b`)).toThrow(/at most 64/);
    expect(() => parseLabel(`b::${part}a`)).toThrow(/at most 64/);
    expect(() => parseLabel(`${part}a`)).toThrow(/at most 64/);
  });
});

describe('normalizeProjectLabel and formatLabel', () => {
  it('normalizes to the stored text, and formats parts back', () => {
    expect(normalizeProjectLabel('State::Temp')).toBe('state::temp');
    expect(formatLabel({ key: 'state', value: 'temp' })).toBe('state::temp');
    expect(formatLabel({ value: 'sandbox' })).toBe('sandbox');
  });
});

describe('labelsOf', () => {
  it('parses the labels of a project, and reads a project of an old registry (no labels) as having none', () => {
    expect(labelsOf(makeProject(1, { labels: ['state::temp', 'sandbox'] }))).toEqual([
      { key: 'state', value: 'temp', text: 'state::temp' },
      { value: 'sandbox', text: 'sandbox' },
    ]);
    expect(labelsOf(makeProject(1))).toEqual([]);
  });
});

describe('selectors', () => {
  const project = makeProject(1, { labels: ['state::production', 'sandbox', 'owner::alice', 'owner::bob'] });

  it.each([
    ['state::production', true],
    ['state::temp', false],
    ['STATE::Production', true],
    ['state', true],
    ['owner', true],
    ['owner::bob', true],
    ['sandbox', true],
    ['alice', false],
    ['production', false],
    ['missing', false],
  ])('hasLabel(%s) is %s', (selector, expected) => {
    expect(hasLabel(project, selector)).toBe(expected);
  });

  it('a bare selector matches a bare label of that value and any key::value label of that key', () => {
    expect(hasLabel(makeProject(2, { labels: ['team', 'team::core'] }), 'team')).toBe(true);
    expect(hasLabel(makeProject(3, { labels: ['team::core'] }), 'team')).toBe(true);
    expect(hasLabel(makeProject(4, { labels: ['team'] }), 'team')).toBe(true);
    expect(hasLabel(makeProject(5, { labels: ['team::core'] }), 'core')).toBe(false);
  });

  it('several selectors must all match, none matches everything', () => {
    expect(matchesSelectors(project, ['state', 'sandbox'])).toBe(true);
    expect(matchesSelectors(project, ['state::production', 'owner::bob'])).toBe(true);
    expect(matchesSelectors(project, ['state', 'missing'])).toBe(false);
    expect(matchesSelectors(project, [])).toBe(true);
  });

  it('refuses an invalid selector instead of matching nothing', () => {
    expect(() => hasLabel(project, 'a::b::c')).toThrow(InvalidProjectLabelError);
    expect(() => matchesSelectors(project, ['ok', ''])).toThrow(InvalidProjectLabelError);
  });

  it('a project of an old registry matches no selector but the empty list', () => {
    expect(hasLabel(makeProject(1), 'sandbox')).toBe(false);
    expect(matchesSelectors(makeProject(1), [])).toBe(true);
  });
});

describe('filterProjects', () => {
  const a = makeProject(1, { name: 'a', labels: ['state::production', 'sandbox'] });
  const b = makeProject(2, { name: 'b', labels: ['state::temp'] });
  const c = makeProject(3, { name: 'c' });
  const registry = makeRegistry(a, b, c);

  it('keeps the projects matching every selector, in registry order', () => {
    expect(filterProjects(registry, ['state']).map((p) => p.name)).toEqual(['a', 'b']);
    expect(filterProjects(registry, ['state::production']).map((p) => p.name)).toEqual(['a']);
    expect(filterProjects(registry, ['state', 'sandbox']).map((p) => p.name)).toEqual(['a']);
    expect(filterProjects(registry, []).map((p) => p.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('validateProjectLabels', () => {
  const problem = (labels: string[]) => () => validateProjectLabels(makeProject(1, { name: 'shop', labels }));

  it('accepts none, a few, and 32', () => {
    expect(problem([])).not.toThrow();
    expect(problem(['a', 'b::c'])).not.toThrow();
    expect(problem(Array.from({ length: 32 }, (_, i) => `l${i}`))).not.toThrow();
    expect(() => validateProjectLabels(makeProject(1))).not.toThrow();
  });

  it('refuses a syntax error, a label not stored normalized, a duplicate and more than 32', () => {
    expect(problem(['a::b::c'])).toThrow(/shop \(00000001\).*a::b::c/s);
    expect(problem(['Sandbox'])).toThrow(/stored lowercase and trimmed/);
    expect(problem(['a', 'a'])).toThrow(/twice/);
    expect(problem(Array.from({ length: 33 }, (_, i) => `l${i}`))).toThrow(/at most 32/);
  });
});
