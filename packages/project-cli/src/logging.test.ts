import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness } from './testHelpers.js';

describe('the log of an invocation', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  const logFile = () => join(h.registryDir, 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`);
  const log = (): { level: string; msg: string }[] =>
    readFileSync(logFile(), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { level: string; msg: string });
  const lines = () => log().map((e) => `${e.level}: ${e.msg}`);

  it('records the command and its success', async () => {
    await h.cli(['list']);
    expect(lines()).toEqual(['info: cmd: project list', 'info: exit 0']);
  });

  it('records a project error at error level with its code', async () => {
    const result = await h.cli(['add', 'missing', '--name', 'm']);
    expect(result.code).toBe(1);
    expect(lines()).toEqual(['info: cmd: project add missing --name m', 'error: exit 1 (INVALID_PATH)']);
  });

  it('records a usage error, an unknown command and a failed cli command with their own codes', async () => {
    await h.cli(['list', '--nope']);
    await h.cli(['shw']);
    await h.cli(['cli', 'update']);
    expect(lines().filter((l) => l.startsWith('error'))).toEqual(['error: exit 2 (USAGE)', 'error: exit 2 (USAGE)', 'error: exit 1 (CLI_ERROR)']);
  });

  it('records the project that was found, and every registry change with ids and names only', async () => {
    const shop = h.dir('shop');
    await h.cli(['add', shop, '--alias', 'sh', '--git', 'https://user:s3cret@host/x.git']);
    await h.cli(['rename', 'sh', 'store']);
    await h.cli(['git', 'set', 'store', 'https://user:s3cret@host/y.git']);
    await h.cli(['show', 'store']);
    await h.cli(['remove', 'store']);
    const text = lines().join('\n');
    expect(text).toMatch(/info: mutation: add project shop \([0-9a-f]{8}\)/);
    expect(text).toMatch(/info: mutation: rename shop \([0-9a-f]{8}\) -> store/);
    expect(text).toMatch(/info: mutation: git set on store \([0-9a-f]{8}\)/);
    expect(text).toMatch(/info: project: store \([0-9a-f]{8}\) via <ref> argument/);
    expect(text).toMatch(/info: mutation: remove store \([0-9a-f]{8}\)/);
    expect(text).not.toContain('s3cret');
  });

  it('records the other mutations', async () => {
    const shop = h.dir('shop');
    const wt = h.dir('wt');
    await h.cli(['add', shop]);
    await h.cli(['add', '--virtual', '--name', 'base']);
    await h.cli(['alias', 'add', 'shop', 'sh']);
    await h.cli(['alias', 'remove', 'shop', 'sh']);
    await h.cli(['parent', 'set', 'shop', 'base']);
    await h.cli(['parent', 'clear', 'shop']);
    await h.cli(['git', 'clear', 'shop']);
    await h.cli(['paths', 'add', 'shop', wt]);
    await h.cli(['paths', 'main', 'shop', wt]);
    await h.cli(['paths', 'move', 'shop', shop, h.dir('moved')]);
    await h.cli(['paths', 'remove', 'shop', h.dir('moved')]);
    const mutations = log().filter((e) => e.msg.startsWith('mutation: ')).map((e) => e.msg.replace(/\([0-9a-f]{8}\)/g, '(id)'));
    expect(mutations).toEqual([
      'mutation: add project shop (id)',
      'mutation: add project base (id)',
      "mutation: alias add 'sh' to shop (id)",
      "mutation: alias remove 'sh' from shop (id)",
      'mutation: parent set shop (id) -> base (id)',
      'mutation: parent clear on shop (id)',
      'mutation: git clear on shop (id)',
      `mutation: paths add shop (id): ${wt}`,
      `mutation: paths main shop (id): ${wt}`,
      `mutation: paths move shop (id): ${shop} -> ${h.dir('moved')}`,
      `mutation: paths remove shop (id): ${h.dir('moved')}`,
    ]);
  });

  it('does not log reads as mutations, nor the contents of the registry', async () => {
    await h.cli(['add', h.dir('shop')]);
    await h.cli(['list', '--json']);
    await h.cli(['show', 'shop', '--json']);
    const text = readFileSync(logFile(), 'utf8');
    expect(text).not.toContain('createdAt');
    expect(text).not.toContain('schemaVersion');
    expect(log().filter((e) => e.msg.startsWith('mutation: '))).toHaveLength(1);
  });

  it('warns once on stderr, and still runs the command, when the log cannot be written', async () => {
    mkdirSync(h.registryDir, { recursive: true });
    writeFileSync(join(h.registryDir, 'logs'), 'a file where the logs folder should be');
    const result = await h.cli(['add', h.dir('shop')]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('added shop');
    const warnings = result.err.split('\n').filter((line) => line.startsWith('warning: could not write the log ('));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^warning: could not write the log \(.+\)$/);
  });
});
