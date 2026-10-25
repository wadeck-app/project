import { describe, expect, it } from 'vitest';
import { ProjectNotFoundError, ProjectOptionError } from './errors.js';
import { extractProjectOption, resolveProjectFromArgs } from './projectOption.js';
import { makeProject, makeRegistry } from './testHelpers.js';

const ENV = 'TASK_PROJECT';

describe('extractProjectOption', () => {
  it.each([
    [['-p', 'shop', 'list'], ['list']],
    [['--project', 'shop', 'list'], ['list']],
    [['--project=shop', 'list'], ['list']],
    [['list', '-p', 'shop'], ['list']],
    [['list', '--project', 'shop', '--json'], ['list', '--json']],
    [['list', '--project=shop', 'x'], ['list', 'x']],
    [['a', '-p', 'shop', 'b', 'c'], ['a', 'b', 'c']],
  ])('takes the flag out of %j wherever it is', (argv, rest) => {
    expect(extractProjectOption(argv, {}, ENV)).toEqual({ args: rest, flag: 'shop' });
  });

  it('returns the arguments untouched, and no flag, when there is none', () => {
    const argv = ['list', '--json', '-x'];
    const result = extractProjectOption(argv, {}, ENV);
    expect(result).toEqual({ args: ['list', '--json', '-x'] });
    expect(result.args).not.toBe(argv);
  });

  it('does not change the array it is given', () => {
    const argv = ['-p', 'shop', 'list'];
    extractProjectOption(argv, {}, ENV);
    expect(argv).toEqual(['-p', 'shop', 'list']);
  });

  it('never looks after `--`, which is kept with what follows it', () => {
    expect(extractProjectOption(['run', '-p', 'shop', '--', '-p', 'other', '--project=x'], {}, ENV)).toEqual({
      args: ['run', '--', '-p', 'other', '--project=x'],
      flag: 'shop',
    });
    expect(extractProjectOption(['run', '--', '-p', 'other'], {}, ENV)).toEqual({ args: ['run', '--', '-p', 'other'] });
  });

  it('reads the project from the environment variable, blank counting as unset', () => {
    expect(extractProjectOption(['list'], { TASK_PROJECT: 'blog' }, ENV)).toEqual({ args: ['list'], env: 'blog' });
    expect(extractProjectOption(['list'], { TASK_PROJECT: '   ' }, ENV)).toEqual({ args: ['list'] });
    expect(extractProjectOption(['list'], { TASK_PROJECT: '' }, ENV)).toEqual({ args: ['list'] });
    expect(extractProjectOption(['list'], { OTHER: 'x' }, ENV)).toEqual({ args: ['list'] });
  });

  it('returns both, the caller (resolveScope) decides which wins', () => {
    expect(extractProjectOption(['-p', 'shop'], { TASK_PROJECT: 'blog' }, ENV)).toEqual({ args: [], flag: 'shop', env: 'blog' });
  });

  it.each([[['-p']], [['list', '--project']], [['-p', '--json']], [['--project', '-x', 'a']]])('fails loudly when %j has no value', (argv) => {
    const run = () => extractProjectOption(argv, {}, ENV);
    expect(run).toThrow(ProjectOptionError);
    expect(run).toThrow(/needs a value.*name, an alias or the id/s);
  });

  it('fails loudly when the flag is given twice, in any forms, naming both', () => {
    for (const argv of [['-p', 'a', '-p', 'b'], ['--project', 'a', '--project=b'], ['-p', 'a', '--project', 'a']]) {
      const run = () => extractProjectOption(argv, {}, ENV);
      expect(run).toThrow(ProjectOptionError);
      expect(run).toThrow(/given twice/);
    }
  });

  it('carries a stable code and the data of the problem', () => {
    try {
      extractProjectOption(['-p'], {}, ENV);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_PROJECT_OPTION', kind: 'missing-value', option: '-p' });
      return;
    }
    throw new Error('expected an error');
  });

  it('a repeated flag after `--` is not a repetition', () => {
    expect(extractProjectOption(['-p', 'a', '--', '-p', 'b'], {}, ENV)).toEqual({ args: ['--', '-p', 'b'], flag: 'a' });
  });

  it('an empty value is passed on, resolveScope refuses it with its own message', () => {
    expect(extractProjectOption(['--project='], {}, ENV)).toEqual({ args: [], flag: '' });
  });
});

describe('resolveProjectFromArgs', () => {
  const base = process.platform === 'win32' ? 'C:/work' : '/work';
  const shop = makeProject(1, { name: 'shop', paths: [{ path: `${base}/shop`, main: true }] });
  const blog = makeProject(2, { name: 'blog', aliases: ['bl'], paths: [{ path: `${base}/blog`, main: true }] });
  const registry = makeRegistry(shop, blog);

  it('resolves the flag wherever it is, and returns the other arguments', () => {
    const result = resolveProjectFromArgs(registry, ['list', '-p', 'bl', '--json'], {}, ENV, `${base}/shop`);
    expect(result.scope).toMatchObject({ source: 'flag', via: '--project', path: `${base}/blog`, pathVia: 'main' });
    expect(result.scope.project.name).toBe('blog');
    expect(result.args).toEqual(['list', '--json']);
  });

  it('falls back on the environment variable, named in the scope, then on the cwd', () => {
    const fromEnv = resolveProjectFromArgs(registry, ['list'], { TASK_PROJECT: 'blog' }, ENV, `${base}/shop`);
    expect(fromEnv.scope).toMatchObject({ source: 'env', via: ENV });
    expect(fromEnv.scope.project.name).toBe('blog');
    const fromCwd = resolveProjectFromArgs(registry, ['list'], {}, ENV, `${base}/shop/src`);
    expect(fromCwd.scope).toMatchObject({ source: 'cwd', path: `${base}/shop` });
  });

  it('the flag wins over the environment variable', () => {
    expect(resolveProjectFromArgs(registry, ['-p', 'shop'], { TASK_PROJECT: 'blog' }, ENV, base).scope.project.name).toBe('shop');
  });

  it('does not resolve what is after `--`', () => {
    const result = resolveProjectFromArgs(registry, ['run', '--', '-p', 'blog'], {}, ENV, `${base}/shop`);
    expect(result.scope.project.name).toBe('shop');
    expect(result.args).toEqual(['run', '--', '-p', 'blog']);
  });

  it('passes on the errors of the option and of the resolution', () => {
    expect(() => resolveProjectFromArgs(registry, ['-p'], {}, ENV, base)).toThrow(ProjectOptionError);
    expect(() => resolveProjectFromArgs(registry, ['-p', 'shpo'], {}, ENV, base)).toThrow(ProjectNotFoundError);
    expect(() => resolveProjectFromArgs(registry, [], {}, ENV, `${base}/elsewhere`)).toThrow(/no project in scope/);
  });
});
