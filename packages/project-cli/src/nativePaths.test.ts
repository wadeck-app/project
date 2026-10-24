import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness, native } from './testHelpers.js';

const isWin = process.platform === 'win32';

// For people: the platform's separators. For scripts (--json, `project path`) and the log: the stored form, forward slashes.
describe('paths shown by the CLI', () => {
  let h: Harness;
  let shop: string;
  let wt: string;

  beforeEach(async () => {
    h = makeHarness();
    shop = h.dir('shop');
    wt = h.dir('shop-wt');
    await h.cli(['add', shop]);
  });
  afterEach(() => h.cleanup());

  const logLines = () =>
    readFileSync(join(h.registryDir, 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`), 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => (JSON.parse(l) as { msg: string }).msg);

  it.runIf(isWin)('human output uses backslashes on win32 (list, show, resolve, add, paths, remove, the resolution line, the suggested command)', async () => {
    const elsewhere = h.dir('elsewhere');
    const everything = [
      (await h.cli(['list'])).out,
      (await h.cli(['show', 'shop'])).out,
      (await h.cli(['resolve'], { cwd: shop })).out,
      (await h.cli(['resolve'], { cwd: shop })).err,
      (await h.cli(['paths', 'add', 'shop', wt])).out,
      (await h.cli(['resolve'], { cwd: elsewhere })).err,
      (await h.cli(['remove', 'shop'])).out,
    ].join('\n');
    // Only the paths of the work folders: the registry folder is printed natively by design and is not under test here.
    const workPaths = everything.split(/\s+/).filter((token) => token.toLowerCase().includes('project-cli-ws-') && token.toLowerCase().includes('work'));
    expect(workPaths.length).toBeGreaterThan(5);
    for (const token of workPaths.filter((t) => !t.toLowerCase().includes('xdg'))) {
      expect(token, token).not.toContain('/');
    }
  });

  it('the stderr resolution line shows the path natively; the log keeps it as stored', async () => {
    const result = await h.cli(['resolve'], { cwd: shop });
    expect(result.err).toContain(`path ${native(shop)} (cwd)`);
    expect(logLines().find((m) => m.startsWith('project: shop'))).toContain(`path ${shop} (cwd)`);
  });

  it('mutation log lines keep the stored form', async () => {
    await h.cli(['paths', 'add', 'shop', wt]);
    expect(logLines()).toContain(`mutation: paths add shop (${loadedId()}): ${wt}`);
  });

  it('--json keeps the stored form, so scripts see the same path on every platform', async () => {
    await h.cli(['paths', 'add', 'shop', wt]);
    for (const argv of [['list', '--json'], ['show', 'shop', '--json'], ['resolve', '-p', 'shop', '--json'], ['paths', 'main', 'shop', wt, '--json']]) {
      const out = (await h.cli(argv)).out;
      expect(out, argv.join(' ')).toContain(shop);
      // JSON escapes a backslash as two: the native form of the work folder would show up that way.
      if (isWin) {
        expect(out, argv.join(' ')).not.toContain(JSON.stringify(native(shop)).slice(1, -1));
      }
    }
  });

  it('project path prints the stored form: it is meant to be used in scripts (cd "$(project path shop)")', async () => {
    const out = (await h.cli(['path', 'shop'])).out;
    expect(out).not.toContain('\\');
  });

  function loadedId(): string {
    return /\(([0-9a-f]{8})\)/.exec(logLines().find((m) => m.startsWith('mutation: add project shop'))!)![1]!;
  }
});
