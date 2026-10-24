import { describe, expect, it } from 'vitest';
import { type ConfigSchema, mergeLayers, validateLayer } from './config.js';
import { ConfigSchemaError } from './errors.js';

const schema: ConfigSchema = {
  sections: {
    queue: { scope: 'global' },
    statuses: { scope: 'local' },
    defaults: { scope: 'inherit' },
    settings: { scope: 'inherit', merge: 'deep' },
    plugins: { scope: 'inherit', merge: 'replace' },
    subscribers: { scope: 'inherit', merge: 'append' },
  },
};

describe('validateLayer', () => {
  it('accepts declared keys at the right level', () => {
    expect(() => validateLayer(schema, 'global', { queue: {}, defaults: {}, subscribers: [] }, 'global')).not.toThrow();
    expect(() => validateLayer(schema, 'shop', { statuses: [], defaults: {}, plugins: [] }, 'project')).not.toThrow();
  });

  it('refuses an unknown key, naming the layer, the key and the declared keys', () => {
    const run = () => validateLayer(schema, 'project shop (task/config.yml)', { colour: 1 }, 'project');
    expect(run).toThrow(ConfigSchemaError);
    expect(run).toThrow(/project shop \(task\/config\.yml\).*'colour'.*not declared.*defaults, plugins/s);
  });

  it('refuses a global-scope key in a project layer instead of ignoring it', () => {
    const run = () => validateLayer(schema, 'shop', { queue: { workers: 2 } }, 'project');
    expect(run).toThrow(ConfigSchemaError);
    expect(run).toThrow(/shop.*'queue'.*global-only.*move it to the global config/s);
  });

  it('refuses a local-scope key in the global layer', () => {
    expect(() => validateLayer(schema, 'global', { statuses: [] }, 'global')).toThrow(/'statuses'.*project-only/s);
  });

  it('refuses a prototype-polluting key', () => {
    const layer = JSON.parse('{"__proto__": {"x": 1}}') as Record<string, unknown>;
    expect(() => validateLayer(schema, 'global', layer, 'global')).toThrow(ConfigSchemaError);
  });
});

describe('mergeLayers', () => {
  it('returns empty values for no layers', () => {
    expect(mergeLayers(schema, [])).toEqual({ values: {}, origins: {} });
  });

  it('deep-merges inherit sections by default, child wins, arrays replaced', () => {
    const result = mergeLayers(schema, [
      { name: 'global', values: { defaults: { priority: 'low', labels: ['a'], nested: { x: 1, y: 2 } } } },
      { name: 'shared', values: { defaults: { labels: ['b'], nested: { y: 3, z: 4 } } } },
      { name: 'shop', values: { defaults: { priority: 'high' } } },
    ]);
    expect(result.values).toEqual({ defaults: { priority: 'high', labels: ['b'], nested: { x: 1, y: 3, z: 4 } } });
    expect(result.origins).toEqual({ defaults: 'shop' });
  });

  it('honors an explicit deep strategy', () => {
    const result = mergeLayers(schema, [
      { name: 'a', values: { settings: { one: 1 } } },
      { name: 'b', values: { settings: { two: 2 } } },
    ]);
    expect(result.values['settings']).toEqual({ one: 1, two: 2 });
  });

  it('replaces the whole section with the strategy replace', () => {
    const result = mergeLayers(schema, [
      { name: 'global', values: { plugins: ['a', 'b'] } },
      { name: 'shop', values: { plugins: ['c'] } },
    ]);
    expect(result.values['plugins']).toEqual(['c']);
    expect(result.origins['plugins']).toBe('shop');
  });

  it('concatenates arrays parent-then-child with the strategy append', () => {
    const result = mergeLayers(schema, [
      { name: 'global', values: { subscribers: [{ id: 1 }] } },
      { name: 'shared', values: {} },
      { name: 'shop', values: { subscribers: [{ id: 2 }, { id: 3 }] } },
    ]);
    expect(result.values['subscribers']).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(result.origins['subscribers']).toBe('shop');
  });

  it('refuses append on a non-array value, naming the layer and key', () => {
    const run = () =>
      mergeLayers(schema, [
        { name: 'global', values: { subscribers: [] } },
        { name: 'shop', values: { subscribers: 'oops' } },
      ]);
    expect(run).toThrow(ConfigSchemaError);
    expect(run).toThrow(/shop.*'subscribers'.*array/s);
  });

  it('takes only the last layer value for local sections', () => {
    const result = mergeLayers(schema, [
      { name: 'shared', values: { statuses: ['a'] } },
      { name: 'shop', values: { statuses: ['b'] } },
    ]);
    expect(result.values['statuses']).toEqual(['b']);
    expect(result.origins['statuses']).toBe('shop');
  });

  it('keeps the origin of a value a child layer did not override', () => {
    const result = mergeLayers(schema, [
      { name: 'global', values: { plugins: ['a'], defaults: { priority: 'low' } } },
      { name: 'shop', values: { defaults: { priority: 'high' } } },
    ]);
    expect(result.origins).toEqual({ plugins: 'global', defaults: 'shop' });
  });

  it('fails on an unknown key instead of ignoring it', () => {
    expect(() => mergeLayers(schema, [{ name: 'shop', values: { nope: 1 } }])).toThrow(/shop.*'nope'/s);
  });

  it('does not mutate its inputs nor share references with them', () => {
    const parent = { defaults: { nested: { x: 1 } } };
    const child = { defaults: { nested: { y: 2 } } };
    const result = mergeLayers(schema, [
      { name: 'a', values: parent },
      { name: 'b', values: child },
    ]);
    (result.values['defaults'] as { nested: { x: number } }).nested.x = 99;
    expect(parent).toEqual({ defaults: { nested: { x: 1 } } });
    expect(child).toEqual({ defaults: { nested: { y: 2 } } });
  });
});

describe('mergeLayers: local sections are never inherited', () => {
  it('gives no value to a project whose own layer lacks the key, even when an ancestor sets it', () => {
    const result = mergeLayers(schema, [
      { name: 'base', values: { statuses: ['a'] } },
      { name: 'shop', values: {} },
    ]);
    expect(result.values).not.toHaveProperty('statuses');
    expect(result.origins).not.toHaveProperty('statuses');
  });

  it('uses the own value when both set it, and reports the own layer as origin', () => {
    const result = mergeLayers(schema, [
      { name: 'base', values: { statuses: ['a'] } },
      { name: 'shop', values: { statuses: ['b'] } },
    ]);
    expect(result.values['statuses']).toEqual(['b']);
    expect(result.origins['statuses']).toBe('shop');
  });

  it('ignores an ancestor local key without error, and leaves the other keys merged as before', () => {
    const result = mergeLayers(schema, [
      { name: 'global', values: { queue: { workers: 2 }, plugins: ['p'] } },
      { name: 'base', values: { statuses: ['a'], defaults: { priority: 'low' } } },
      { name: 'shop', values: { defaults: { priority: 'high' } } },
    ]);
    expect(result.values).toEqual({ queue: { workers: 2 }, plugins: ['p'], defaults: { priority: 'high' } });
    expect(result.origins).toEqual({ queue: 'global', plugins: 'global', defaults: 'shop' });
  });

  it('still refuses an unknown key in an ancestor layer', () => {
    expect(() => mergeLayers(schema, [{ name: 'base', values: { nope: 1 } }, { name: 'shop', values: {} }])).toThrow(/base.*'nope'/s);
  });

  it('still refuses a global-scope key in a project layer through validateLayer', () => {
    expect(() => validateLayer(schema, 'base', { queue: {} }, 'project')).toThrow(/global-only/);
  });
});
