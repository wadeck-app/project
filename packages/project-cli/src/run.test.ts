import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './run.js';
import { type Harness, makeHarness } from './testHelpers.js';

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

describe('run', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  it('prints the version from package.json', async () => {
    const result = await h.cli(['--version']);
    expect(result).toEqual({ code: 0, out: version, err: '' });
  });

  it('lists every command in the top-level help', async () => {
    const result = await h.cli(['--help']);
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    for (const name of ['add', 'list', 'show', 'path', 'resolve', 'rename', 'alias add', 'alias remove', 'parent set', 'parent clear', 'git set', 'git clear', 'paths add', 'paths remove', 'paths move', 'paths main', 'remove']) {
      expect(result.out).toContain(`project ${name}`);
    }
    expect(result.out).toContain('--project');
  });

  it('prints the help of one command, with its options', async () => {
    const result = await h.cli(['add', '--help']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Usage: project add [path]');
    expect(result.out).toContain('--virtual');
    expect(result.out).toContain('--alias <alias>');
  });

  it('documents the explicit <ref> of remove and no --project for it', async () => {
    const result = await h.cli(['remove', '--help']);
    expect(result.out).toContain('Usage: project remove <ref> [options]');
    expect(result.out).not.toContain('--project');
  });

  it('prints the subcommands of a group', async () => {
    const result = await h.cli(['paths', '--help']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('project paths move');
    expect(result.out).not.toContain('project rename');
  });

  it('exits 2 with a hint when no command is given', async () => {
    const result = await h.cli([]);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(result.err).toBe("error: no command given\nRun 'project --help' for usage.");
  });

  it('exits 2 for an unknown command, a missing subcommand and an unknown option', async () => {
    expect((await h.cli(['shw'])).err).toContain("error: unknown command 'shw'");
    const group = await h.cli(['paths']);
    expect(group.code).toBe(2);
    expect(group.err).toContain("error: 'paths' needs a subcommand: add, remove, move, main");
    const option = await h.cli(['list', '--nope']);
    expect(option.code).toBe(2);
    expect(option.err).toContain("unknown option '--nope' for 'project list'");
    expect(option.err).toContain("Run 'project list --help'");
  });

  it('exits 70 with the stack on an unexpected exception', async () => {
    const err: string[] = [];
    const code = await run(
      ['list'],
      {
        out: () => {
          throw new Error('boom');
        },
        err: (line) => err.push(line),
      },
      h.env,
      h.dir('x'),
    );
    expect(code).toBe(70);
    expect(err.join('\n')).toContain('Error: boom');
    expect(err.join('\n')).toContain('unexpected error');
  });
});
