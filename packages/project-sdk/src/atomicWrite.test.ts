import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomicWrite.js';
import { AtomicWriteError, LockLostError } from './errors.js';

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-sdk-atomic-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the file with the content', () => {
    writeFileAtomic(join(dir, 'a.json'), '{"a":1}');
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('{"a":1}');
  });

  it('replaces an existing file and leaves no temp file behind', () => {
    writeFileSync(join(dir, 'a.json'), 'old');
    writeFileAtomic(join(dir, 'a.json'), 'new');
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['a.json']);
  });

  it('writes the temp file in the same directory and keeps the target intact until the rename', () => {
    writeFileSync(join(dir, 'a.json'), 'old');
    let duringRename: string[] = [];
    let targetDuringRename = '';
    writeFileAtomic(join(dir, 'a.json'), 'new', {
      beforeRename: () => {
        duringRename = readdirSync(dir);
        targetDuringRename = readFileSync(join(dir, 'a.json'), 'utf8');
      },
    });
    expect(duringRename).toHaveLength(2);
    expect(duringRename.filter((name) => name !== 'a.json')[0]).toMatch(/^a\.json\..+\.tmp$/);
    expect(targetDuringRename).toBe('old');
  });

  it('aborts without touching the target and removes the temp file when beforeRename throws', () => {
    writeFileSync(join(dir, 'a.json'), 'old');
    expect(() =>
      writeFileAtomic(join(dir, 'a.json'), 'new', {
        beforeRename: () => {
          throw new Error('stop');
        },
      }),
    ).toThrow('stop');
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['a.json']);
  });

  it('rethrows a SDK error raised by beforeRename unchanged', () => {
    expect(() =>
      writeFileAtomic(join(dir, 'a.json'), 'new', {
        beforeRename: () => {
          throw new LockLostError('lost');
        },
      }),
    ).toThrow(LockLostError);
  });

  it('fails loudly with an actionable error when the directory is missing', () => {
    const file = join(dir, 'missing', 'a.json');
    expect(() => writeFileAtomic(file, 'x')).toThrow(AtomicWriteError);
    expect(() => writeFileAtomic(file, 'x')).toThrow(/cannot write .*a\.json.*directory exists/s);
    expect(existsSync(file)).toBe(false);
  });

  it('writes distinct temp files for successive writes (unique names)', () => {
    const names = new Set<string>();
    for (let i = 0; i < 3; i++) {
      writeFileAtomic(join(dir, 'a.json'), String(i), {
        beforeRename: () => readdirSync(dir).filter((n) => n.endsWith('.tmp')).forEach((n) => names.add(n)),
      });
    }
    expect(names.size).toBe(3);
  });
});
