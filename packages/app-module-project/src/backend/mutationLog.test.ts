import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logMutation } from './mutationLog.js';

describe('logMutation', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-module-log-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

  const file = () => join(dir, 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`);

  it('appends one line to the daily log of the registry folder, in the format of the CLI and of the updater, naming where it came from', () => {
    logMutation(dir, 'rename shop (3fa9c1d2) -> store');
    logMutation(dir, 'add project blog (0a1b2c3d)');
    const lines = readFileSync(file(), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { ts: string; level: string; msg: string });
    expect(lines.map((l) => [l.level, l.msg])).toEqual([
      ['info', 'mutation: rename shop (3fa9c1d2) -> store (via the project module)'],
      ['info', 'mutation: add project blog (0a1b2c3d) (via the project module)'],
    ]);
    expect(lines[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('never blocks the change when the log cannot be written, but says so on stderr', () => {
    writeFileSync(join(dir, 'logs'), 'a file where the logs folder should be');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() => logMutation(dir, 'x')).not.toThrow();
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]![0])).toMatch(/^\[project module\] could not write the log \(.+\)\n$/);
  });

  it('creates the logs folder when the registry folder exists but has no logs yet', () => {
    mkdirSync(join(dir, 'nested'));
    logMutation(join(dir, 'nested'), 'x');
    expect(readFileSync(join(dir, 'nested', 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`), 'utf8')).toContain('mutation: x');
  });
});
