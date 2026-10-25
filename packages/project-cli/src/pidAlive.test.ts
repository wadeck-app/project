import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isPidAlive } from './pidAlive.js';

describe('isPidAlive', () => {
  it('is true for this process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('is false for a process that has exited', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = child.pid!;
    await new Promise((resolve) => child.on('close', resolve));
    expect(isPidAlive(pid)).toBe(false);
  });

  it('counts EPERM (the process exists, owned by someone else) as alive, ESRCH as dead', () => {
    const killing = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(isPidAlive(1, killing('EPERM'))).toBe(true);
    expect(isPidAlive(1, killing('ESRCH'))).toBe(false);
  });

  it('does not take other failures for a dead process', () => {
    expect(() => isPidAlive(1, () => { throw Object.assign(new Error('boom'), { code: 'EINVAL' }); })).toThrow('boom');
  });
});
