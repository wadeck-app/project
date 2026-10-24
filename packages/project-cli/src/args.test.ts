import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';
import { UsageError } from './errors.js';

const specs = {
  name: { type: 'string' as const, description: 'the name' },
  project: { type: 'string' as const, short: 'p', description: 'the project' },
  alias: { type: 'list' as const, description: 'an alias' },
  main: { type: 'boolean' as const, description: 'main flag' },
};

describe('parseArgs', () => {
  it('splits positionals and options in any order', () => {
    const parsed = parseArgs(['one', '--name', 'x', 'two', '--main'], specs, 'project add');
    expect(parsed.positionals).toEqual(['one', 'two']);
    expect(parsed.options.value('name')).toBe('x');
    expect(parsed.options.flag('main')).toBe(true);
  });

  it('accepts --name=value and the short form', () => {
    const parsed = parseArgs(['--name=a=b', '-p', 'shop'], specs, 'project add');
    expect(parsed.options.value('name')).toBe('a=b');
    expect(parsed.options.value('project')).toBe('shop');
  });

  it('collects a repeated list option in order', () => {
    const parsed = parseArgs(['--alias', 'a', '--alias=b'], specs, 'project add');
    expect(parsed.options.list('alias')).toEqual(['a', 'b']);
  });

  it('reports absent options as false, undefined and empty', () => {
    const parsed = parseArgs([], specs, 'project add');
    expect(parsed.options.flag('main')).toBe(false);
    expect(parsed.options.value('name')).toBeUndefined();
    expect(parsed.options.list('alias')).toEqual([]);
  });

  it('treats everything after -- as positional', () => {
    const parsed = parseArgs(['--', '--name', '-p'], specs, 'project add');
    expect(parsed.positionals).toEqual(['--name', '-p']);
  });

  it('rejects an unknown option and names the command', () => {
    expect(() => parseArgs(['--nope'], specs, 'project add')).toThrow(UsageError);
    expect(() => parseArgs(['--nope'], specs, 'project add')).toThrow(/unknown option '--nope' for 'project add'/);
    expect(() => parseArgs(['-x'], specs, 'project add')).toThrow(/unknown option '-x'/);
  });

  it('rejects a value option without value', () => {
    expect(() => parseArgs(['--name'], specs, 'project add')).toThrow(/option '--name' needs a value/);
    expect(() => parseArgs(['--name', '--main'], specs, 'project add')).toThrow(/option '--name' needs a value/);
  });

  it('rejects a value given to a boolean option', () => {
    expect(() => parseArgs(['--main=yes'], specs, 'project add')).toThrow(/option '--main' does not take a value/);
  });

  it('rejects a single-value option given twice', () => {
    expect(() => parseArgs(['--name', 'a', '--name', 'b'], specs, 'project add')).toThrow(/option '--name' is given twice/);
  });
});
