import { describe, expect, it } from 'vitest';
import { type ConfigSchema, mergeLayers, validateLayer } from './config.js';
import { ConfigSchemaError } from './errors.js';

const schema: ConfigSchema = {
  sections: {
    queue: { scope: 'global' },
    defaults: { scope: 'inherit' },
    subscribers: { scope: 'inherit', merge: 'append' },
    plugins: {
      scope: 'inherit',
      merge: 'deep',
      fields: {
        github: { scope: 'inherit' },
        slack: { scope: 'inherit' },
        daemon: { scope: 'global' },
        notes: { scope: 'local' },
      },
    },
  },
};

function problem(run: () => void): ConfigSchemaError {
  try {
    run();
  } catch (error) {
    return error as ConfigSchemaError;
  }
  throw new Error('expected a ConfigSchemaError');
}

describe('ConfigSchemaError carries typed fields', () => {
  it('an unknown key tells the layer and the key', () => {
    const error = problem(() => validateLayer(schema, 'project shop (task/config.yml)', { colour: 1 }, 'project'));
    expect(error).toBeInstanceOf(ConfigSchemaError);
    expect(error).toMatchObject({ code: 'CONFIG_SCHEMA', layer: 'project shop (task/config.yml)', key: 'colour' });
    expect(error.path).toBeUndefined();
  });

  it('a misplaced scope tells the layer and the key', () => {
    expect(problem(() => validateLayer(schema, 'shop', { queue: {} }, 'project'))).toMatchObject({ layer: 'shop', key: 'queue' });
    expect(problem(() => validateLayer({ sections: { s: { scope: 'local' } } }, 'global', { s: 1 }, 'global'))).toMatchObject({ layer: 'global', key: 's' });
  });

  it('an append value that is not an array tells the layer and the key', () => {
    const error = problem(() => mergeLayers(schema, [{ name: 'shop', values: { subscribers: 'oops' } }]));
    expect(error).toMatchObject({ layer: 'shop', key: 'subscribers' });
  });

  it('keeps working with the message alone', () => {
    const error = new ConfigSchemaError('m');
    expect(error.layer).toBeUndefined();
    expect(error.key).toBeUndefined();
  });
});

describe('nested keys (one level)', () => {
  it('accepts the declared nested keys', () => {
    expect(() => validateLayer(schema, 'global', { plugins: { github: { a: 1 }, slack: {}, daemon: { x: 1 } } }, 'global')).not.toThrow();
    expect(() => validateLayer(schema, 'shop', { plugins: { github: {}, notes: 'x' } }, 'project')).not.toThrow();
  });

  it('an unknown nested key names the full dotted path, the layer and the declared nested keys', () => {
    const run = () => validateLayer(schema, 'shop', { plugins: { gitlab: {} } }, 'project');
    expect(run).toThrow(/layer 'shop': key 'plugins\.gitlab' is not declared in the config schema \(declared keys: plugins\.daemon, plugins\.github, plugins\.notes, plugins\.slack\); remove or rename it/);
    expect(problem(run)).toMatchObject({ layer: 'shop', key: 'plugins', path: 'plugins.gitlab' });
  });

  it('a global-only nested key is refused in a project layer, a local one in the global layer, with the dotted path', () => {
    const inProject = problem(() => validateLayer(schema, 'shop', { plugins: { daemon: {} } }, 'project'));
    expect(inProject.message).toMatch(/layer 'shop': key 'plugins\.daemon' is global-only and has no effect in a project config; move it to the global config/);
    expect(inProject).toMatchObject({ key: 'plugins', path: 'plugins.daemon' });
    const inGlobal = problem(() => validateLayer(schema, 'global', { plugins: { notes: 'x' } }, 'global'));
    expect(inGlobal.message).toMatch(/key 'plugins\.notes' is project-only and cannot be set in the global config/);
  });

  it('refuses a section with declared fields whose value is not a mapping', () => {
    for (const value of [[], 'x', 3, null]) {
      const error = problem(() => validateLayer(schema, 'shop', { plugins: value }, 'project'));
      expect(error.message).toMatch(/layer 'shop': key 'plugins' must be a mapping of its declared keys \(plugins\.daemon, plugins\.github, plugins\.notes, plugins\.slack\)/);
      expect(error).toMatchObject({ layer: 'shop', key: 'plugins' });
    }
  });

  it('refuses a prototype-polluting nested key', () => {
    const layer = { plugins: JSON.parse('{"__proto__": {"x": 1}}') as Record<string, unknown> };
    expect(() => validateLayer(schema, 'shop', layer, 'project')).toThrow(ConfigSchemaError);
  });

  it('does not validate the inside of a nested key (one level only)', () => {
    expect(() => validateLayer(schema, 'shop', { plugins: { github: { anything: { deep: 1 } } } }, 'project')).not.toThrow();
  });

  it('a section without fields keeps accepting any content', () => {
    expect(() => validateLayer(schema, 'shop', { defaults: { whatever: 1 } }, 'project')).not.toThrow();
  });

  it('merging is unchanged: the nested keys merge as the section says', () => {
    const merged = mergeLayers(schema, [
      { name: 'base', values: { plugins: { github: { a: 1 }, slack: { x: 1 } } } },
      { name: 'shop', values: { plugins: { github: { b: 2 } } } },
    ]);
    expect(merged.values['plugins']).toEqual({ github: { a: 1, b: 2 }, slack: { x: 1 } });
  });
});
