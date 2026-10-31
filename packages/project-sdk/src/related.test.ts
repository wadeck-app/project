import { describe, expect, it } from 'vitest';
import { InvalidRelatedResponseError, ProjectError } from './errors.js';
import { assertRelatedResponse, buildRelatedResponse, isModuleUrl, parseRelatedResponse } from './related.js';

const valid = { title: 'Tasks', items: [{ label: 'Fix it', url: '/modules/task/tasks/a' }] };

function failure(run: () => unknown): InvalidRelatedResponseError {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidRelatedResponseError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an InvalidRelatedResponseError, nothing was thrown');
}

describe('isModuleUrl', () => {
  it.each(['/modules/task', '/modules/task/tasks/a?project=1a2b#top', '/modules/'])('accepts %s', (url) => {
    expect(isModuleUrl(url)).toBe(true);
  });

  it.each([
    ['an external address', 'https://evil.example/x'],
    ['a protocol-relative address', '//evil.example/modules/x'],
    ['a script', 'javascript:alert(1)'],
    ['another path of the app', '/api/modules/task'],
    ['a relative path', 'modules/task'],
    ['a double slash after the prefix', '/modules//evil.example'],
    ['an address inside the query', '/modules/task?next=http://evil.example'],
    ['a backslash', '/modules/task\\..\\x'],
    ['a control character', '/modules/task\n'],
    ['an empty text', ''],
    ['not a text', 42],
    ['nothing', undefined],
  ])('refuses %s', (_name, url) => {
    expect(isModuleUrl(url)).toBe(false);
  });
});

describe('parseRelatedResponse', () => {
  it('returns the panel with the fields of the contract', () => {
    const input = {
      title: 'Tasks',
      count: 3,
      countLabel: 'open',
      truncated: true,
      items: [{ label: 'Fix it', url: '/modules/task/tasks/a', subtitle: 'open' }],
      moreUrl: '/modules/task/tasks',
    };
    expect(parseRelatedResponse(input)).toEqual(input);
  });

  it('keeps only what it needs when the optional fields are absent', () => {
    expect(parseRelatedResponse(valid)).toEqual(valid);
  });

  it('ignores unknown fields of the answer and of the items (the contract can grow)', () => {
    const panel = parseRelatedResponse({ ...valid, project: { name: 'shop' }, items: [{ label: 'a', url: '/modules/x', status: 'green' }] });
    expect(panel).toEqual({ title: 'Tasks', items: [{ label: 'a', url: '/modules/x' }] });
  });

  it('does not change its input', () => {
    const input = { ...valid, extra: 1 };
    parseRelatedResponse(input);
    expect(input).toEqual({ ...valid, extra: 1 });
  });

  it('throws an SDK error with a stable code', () => {
    const error = failure(() => parseRelatedResponse(null));
    expect(error).toBeInstanceOf(ProjectError);
    expect(error.code).toBe('INVALID_RELATED_RESPONSE');
  });

  it.each([
    ['not an object', 'text', '$'],
    ['an array', [], '$'],
    ['no title', { items: [] }, 'title'],
    ['an empty title', { title: ' ', items: [] }, 'title'],
    ['a title that is not a text', { title: 3, items: [] }, 'title'],
    ['no items', { title: 'T' }, 'items'],
    ['items that are not a list', { title: 'T', items: {} }, 'items'],
    ['a negative count', { ...valid, count: -1 }, 'count'],
    ['a count with decimals', { ...valid, count: 1.5 }, 'count'],
    ['a count that is a text', { ...valid, count: '3' }, 'count'],
    ['an empty countLabel', { ...valid, countLabel: '' }, 'countLabel'],
    ['a countLabel that is not a text', { ...valid, countLabel: 3 }, 'countLabel'],
    ['a truncated that is not a boolean', { ...valid, truncated: 'yes' }, 'truncated'],
    ['an item that is not an object', { title: 'T', items: ['x'] }, 'items[0]'],
    ['an item without label', { title: 'T', items: [{ url: '/modules/x' }] }, 'items[0].label'],
    ['an item with an empty label', { title: 'T', items: [{ label: '', url: '/modules/x' }] }, 'items[0].label'],
    ['a second item without url', { title: 'T', items: [{ label: 'a', url: '/modules/x' }, { label: 'b' }] }, 'items[1].url'],
    ['an external item url', { title: 'T', items: [{ label: 'a', url: 'https://evil.example' }] }, 'items[0].url'],
    ['a protocol-relative item url', { title: 'T', items: [{ label: 'a', url: '//evil.example' }] }, 'items[0].url'],
    ['a script item url', { title: 'T', items: [{ label: 'a', url: 'javascript:alert(1)' }] }, 'items[0].url'],
    ['a subtitle that is not a text', { title: 'T', items: [{ label: 'a', url: '/modules/x', subtitle: 3 }] }, 'items[0].subtitle'],
    ['an external moreUrl', { ...valid, moreUrl: 'http://evil.example' }, 'moreUrl'],
  ])('rejects %s, naming the path %s', (_name, input, path) => {
    const error = failure(() => parseRelatedResponse(input));
    expect(error.path).toBe(path);
    expect(error.message).toContain(path === '$' ? 'invalid related response' : `at ${path}`);
  });

  it('says what was expected and what was given for a url, so that the owner of the provider can fix it', () => {
    const error = failure(() => parseRelatedResponse({ title: 'T', items: [{ label: 'a', url: 'https://evil.example' }] }));
    expect(error.message).toContain("must start with '/modules/'");
    expect(error.message).toContain('https://evil.example');
  });
});

describe('buildRelatedResponse (for providers)', () => {
  it('returns the clean panel to send', () => {
    expect(buildRelatedResponse({ title: 'Tasks', count: 2, countLabel: 'open', items: [{ label: 'a', url: '/modules/task/a' }] })).toEqual({
      title: 'Tasks',
      count: 2,
      countLabel: 'open',
      items: [{ label: 'a', url: '/modules/task/a' }],
    });
  });

  it('refuses to build garbage, with the same error as the consumer', () => {
    expect(failure(() => buildRelatedResponse({ title: 'T', items: [{ label: 'a', url: 'https://evil.example' }] })).path).toBe('items[0].url');
  });

  it('drops fields that are not part of the contract', () => {
    const panel = buildRelatedResponse({ title: 'T', items: [], extra: 1 } as never);
    expect(panel).toEqual({ title: 'T', items: [] });
  });
});

describe('assertRelatedResponse (conformance check for the tests of providers)', () => {
  it('passes on a conformant answer', () => {
    expect(() => assertRelatedResponse(valid)).not.toThrow();
  });

  it('throws on an answer that breaks the contract, with the path', () => {
    expect(() => assertRelatedResponse({ title: 'T' })).toThrow(/at items/);
  });
});
