import { describe, expect, it } from 'vitest';
import { splitCommand } from './dispatch.js';

const names = ['add', 'show', 'paths add', 'paths remove', 'alias add'];

describe('splitCommand', () => {
  it('finds a one-word command and leaves the rest in order', () => {
    expect(splitCommand(['add', './x', '--name', 'n'], names)).toEqual({ name: 'add', words: ['add'], rest: ['./x', '--name', 'n'] });
  });

  it('finds a two-word command', () => {
    expect(splitCommand(['paths', 'add', 'shop', '/x', '--main'], names)).toEqual({
      name: 'paths add',
      words: ['paths', 'add'],
      rest: ['shop', '/x', '--main'],
    });
  });

  it('skips the value of --project and -p placed before the command', () => {
    expect(splitCommand(['-p', 'sh', 'show'], names).name).toBe('show');
    expect(splitCommand(['--project=sh', '--json', 'show'], names).name).toBe('show');
    expect(splitCommand(['--project', 'sh', 'paths', '-p', 'x', 'remove', '/y'], names)).toEqual({
      name: 'paths remove',
      words: ['paths', 'remove'],
      rest: ['--project', 'sh', '-p', 'x', '/y'],
    });
  });

  it('reports no command when only options are given', () => {
    expect(splitCommand(['--version'], names)).toEqual({ name: undefined, words: [], rest: ['--version'] });
    expect(splitCommand([], names)).toEqual({ name: undefined, words: [], rest: [] });
  });

  it('reports an unknown word without a name', () => {
    expect(splitCommand(['shw', 'x'], names)).toEqual({ name: undefined, words: ['shw'], rest: ['x'] });
  });

  it('reports a group without a valid subcommand', () => {
    expect(splitCommand(['paths'], names)).toEqual({ name: undefined, words: ['paths'], rest: [] });
    expect(splitCommand(['paths', 'nope'], names)).toEqual({ name: undefined, words: ['paths', 'nope'], rest: [] });
  });

  it('does not look for a command after --', () => {
    expect(splitCommand(['--', 'add'], names)).toEqual({ name: undefined, words: [], rest: ['--', 'add'] });
  });
});
