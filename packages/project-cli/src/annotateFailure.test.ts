import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeTempDir } from './testHelpers.js';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'scripts', 'annotate-failure.mjs');

describe('ci/scripts/annotate-failure.mjs', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'project-cli-annotate-'));
  });
  afterEach(() => removeTempDir(work));

  const run = (title: string, file: string) => spawnSync(process.execPath, [script, title, file], { encoding: 'utf8' });
  const log = (text: string): string => {
    const file = join(work, 'out.log');
    writeFileSync(file, text);
    return file;
  };

  it('prints one GitHub error annotation with the title and the end of the log, on one line', () => {
    const result = run('tests', log('line one\nline two\n'));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('::error title=tests::line one%0Aline two');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('escapes the percent sign, the carriage return and the newline as the workflow commands require', () => {
    const result = run('t', log('100% done\r\nnext\n'));
    expect(result.stdout.trim()).toBe('::error title=t::100%25 done%0D%0Anext');
  });

  it('escapes the characters of the title that would end it (colon, comma)', () => {
    expect(run('verify: install, linux', log('x\n')).stdout).toContain('::error title=verify%3A install%2C linux::x');
  });

  it('keeps the last 60 lines (the failure is at the end)', () => {
    const text = Array.from({ length: 100 }, (_, i) => `row ${i + 1}`).join('\n');
    const out = run('t', log(text)).stdout;
    expect(out).toContain('row 100');
    expect(out).toContain('row 41');
    expect(out).not.toContain('row 40%0A');
    expect(out).not.toMatch(/row 40$/m);
  });

  it('truncates to about 1500 characters, keeping the end, and says it', () => {
    const out = run('t', log(Array.from({ length: 60 }, (_, i) => `${'x'.repeat(80)} end${i}`).join('\n'))).stdout.trim();
    expect(out.length).toBeLessThan(1700);
    expect(out).toContain('end59');
    expect(out).toContain('(truncated)');
  });

  it('says clearly when there is no log (the failure is in an earlier step), instead of printing nothing', () => {
    const result = run('tests', join(work, 'missing.log'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('::error title=tests::');
    expect(result.stdout).toContain('no log file');
  });

  it('says clearly when the log is empty', () => {
    expect(run('tests', log('')).stdout).toContain('the log is empty');
  });

  it('refuses a call without title and file, with the usage', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: annotate-failure.mjs <title> <log file>');
  });
});
