import { describe, expect, it } from 'vitest';
import { lockOptions } from './lockNotice.js';

function notices(info: { pid: number | undefined; ageMs: number; stale: boolean }): string[] {
  const lines: string[] = [];
  const options = lockOptions({ out: () => undefined, err: (line) => lines.push(line) });
  options.onWait!({ lockFile: 'C:/reg/registry.lock', ...info });
  return lines;
}

describe('lockOptions', () => {
  it('prints one stderr line naming the holder pid and the age', () => {
    expect(notices({ pid: 4242, ageMs: 2400, stale: false })).toEqual(['waiting for the registry lock held by pid 4242 (locked for 2s)']);
  });

  it('says so when the holder is unknown', () => {
    expect(notices({ pid: undefined, ageMs: 0, stale: false })).toEqual(['waiting for the registry lock held by an unknown process (locked for 0s)']);
  });

  it('says the lock is stale and being taken over', () => {
    expect(notices({ pid: 7, ageMs: 31_000, stale: true })).toEqual(['waiting for the registry lock held by pid 7 (locked for 31s, stale: taking it over)']);
  });
});
