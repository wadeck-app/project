import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openInvocationLog } from './invocationLog.js';
import { removeTempDir } from './testHelpers.js';

interface Entry {
  ts: string;
  level: string;
  msg: string;
}

describe('openInvocationLog', () => {
  let dir: string;
  let warnings: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-cli-log-'));
    warnings = [];
  });
  afterEach(() => removeTempDir(dir));

  const file = () => join(dir, 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`);
  const entries = (): Entry[] =>
    readFileSync(file(), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Entry);
  const open = (argv: string[]) => openInvocationLog(dir, argv, (reason) => warnings.push(reason));

  it('writes the invocation first, in the daily ndjson file shared with the updater ({ts, level, msg})', () => {
    open(['add', 'shop', '--alias', 'sh']);
    expect(entries()).toEqual([{ ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), level: 'info', msg: 'cmd: project add shop --alias sh' }]);
  });

  it('writes a bare invocation without trailing space', () => {
    open([]);
    expect(entries()[0]!.msg).toBe('cmd: project');
  });

  it('never writes the credentials of a URL given as an argument', () => {
    open(['git', 'set', 'shop', 'https://user:s3cret@github.com/x/y.git']);
    expect(entries()[0]!.msg).toBe('cmd: project git set shop https://***@github.com/x/y.git');
    expect(readFileSync(file(), 'utf8')).not.toContain('s3cret');
  });

  it('logs the resolution line, mutations and the outcome after it', () => {
    const log = open(['rename', 'shop', 'store']);
    log.resolution('project: shop (a1b2c3d4) via <ref> argument, path /w/shop (main); registry: /r');
    log.mutation('rename shop (a1b2c3d4) -> store');
    log.outcome(0);
    expect(entries().map((e) => [e.level, e.msg])).toEqual([
      ['info', 'cmd: project rename shop store'],
      ['info', 'project: shop (a1b2c3d4) via <ref> argument, path /w/shop (main); registry: /r'],
      ['info', 'mutation: rename shop (a1b2c3d4) -> store'],
      ['info', 'exit 0'],
    ]);
  });

  it('logs a failure at error level with the code of the error', () => {
    const log = open(['add']);
    log.outcome(1, 'PATH_OWNED');
    log.outcome(2, 'USAGE');
    expect(entries().slice(1).map((e) => [e.level, e.msg])).toEqual([
      ['error', 'exit 1 (PATH_OWNED)'],
      ['error', 'exit 2 (USAGE)'],
    ]);
  });

  it('warns once, with the reason, and never throws, when the log cannot be written', () => {
    writeFileSync(join(dir, 'logs'), 'not a folder');
    const log = open(['list']);
    expect(() => {
      log.resolution('x');
      log.mutation('y');
      log.outcome(0);
    }).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/\S/);
  });

  it('works when the config folder does not exist yet', () => {
    mkdirSync(join(dir, 'nested'));
    openInvocationLog(join(dir, 'nested', 'project'), ['list'], (reason) => warnings.push(reason));
    expect(warnings).toEqual([]);
  });
});
