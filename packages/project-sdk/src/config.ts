import { ConfigSchemaError } from './errors.js';

export type ConfigScope = 'global' | 'local' | 'inherit';
export type MergeStrategy = 'replace' | 'deep' | 'append';

export interface ConfigSection {
  /** global: only in the global config. local: only in a project config; taken from the project's own (last) layer only, never from its ancestors. inherit: merged along the parent chain. */
  scope: ConfigScope;
  /** Only for scope 'inherit'. Default 'deep' (child wins, arrays replaced). 'append' concatenates arrays parent-then-child. */
  merge?: MergeStrategy;
}

export interface ConfigSchema {
  sections: Record<string, ConfigSection>;
}

export interface NamedLayer {
  name: string;
  values: Record<string, unknown>;
}

export interface MergedConfig {
  values: Record<string, unknown>;
  /** For each top-level key, the name of the layer that provided the effective value. */
  origins: Record<string, string>;
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sectionOf(schema: ConfigSchema, layerName: string, key: string): ConfigSection {
  if (key === '__proto__' || !Object.hasOwn(schema.sections, key)) {
    const declared = Object.keys(schema.sections).sort().join(', ');
    throw new ConfigSchemaError(`layer '${layerName}': key '${key}' is not declared in the config schema (declared keys: ${declared}); remove or rename it`);
  }
  return schema.sections[key]!;
}

/** Checks the top-level keys of one config layer against the schema. Nothing is ignored silently. */
export function validateLayer(schema: ConfigSchema, layerName: string, layer: Record<string, unknown>, level: 'global' | 'project'): void {
  for (const key of Object.keys(layer)) {
    const section = sectionOf(schema, layerName, key);
    if (section.scope === 'global' && level === 'project') {
      throw new ConfigSchemaError(`layer '${layerName}': key '${key}' is global-only and has no effect in a project config; move it to the global config`);
    }
    if (section.scope === 'local' && level === 'global') {
      throw new ConfigSchemaError(`layer '${layerName}': key '${key}' is project-only and cannot be set in the global config; move it to a project config`);
    }
  }
}

function deepMerge(base: unknown, override: unknown, where: string): unknown {
  if (!isPlainObject(override)) {
    return structuredClone(override);
  }
  const result: PlainObject = isPlainObject(base) ? (structuredClone(base) as PlainObject) : {};
  for (const [key, value] of Object.entries(override)) {
    if (key === '__proto__') {
      throw new ConfigSchemaError(`${where}: key '__proto__' is not allowed`);
    }
    result[key] = deepMerge(result[key], value, where);
  }
  return result;
}

function append(base: unknown, override: unknown, layerName: string, key: string): unknown[] {
  if (!Array.isArray(override) || (base !== undefined && !Array.isArray(base))) {
    throw new ConfigSchemaError(`layer '${layerName}': key '${key}' is merged with 'append' so its value must be an array in every layer`);
  }
  return [...(structuredClone(base) ?? []), ...structuredClone(override)];
}

function mergeValue(section: ConfigSection, base: unknown, override: unknown, layerName: string, key: string): unknown {
  const strategy = section.scope === 'inherit' ? (section.merge ?? 'deep') : 'replace';
  if (strategy === 'append') {
    return append(base, override, layerName, key);
  }
  return strategy === 'deep' ? deepMerge(base, override, `layer '${layerName}', key '${key}'`) : structuredClone(override);
}

/**
 * Merges layers root-first (the last layer is the project's own). Merge strategy per section comes from the schema; later layers win.
 * A 'local' key is taken from the last layer only: the same key in an earlier layer is valid there but ignored here,
 * and a project that does not set it gets no value.
 */
export function mergeLayers(schema: ConfigSchema, layers: NamedLayer[]): MergedConfig {
  const values: Record<string, unknown> = {};
  const origins: Record<string, string> = {};
  for (const [index, layer] of layers.entries()) {
    const isOwn = index === layers.length - 1;
    for (const [key, value] of Object.entries(layer.values)) {
      const section = sectionOf(schema, layer.name, key);
      if (section.scope === 'local' && !isOwn) {
        continue;
      }
      values[key] = mergeValue(section, values[key], value, layer.name, key);
      origins[key] = layer.name;
    }
  }
  return { values, origins };
}
