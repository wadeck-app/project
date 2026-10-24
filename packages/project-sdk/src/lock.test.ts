import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomicWrite.js';
import { LockLostError, LockTimeoutError } from './errors.js';
import { type LockWaitInfo, lockFilePath, withRegistryLock } from './lock.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('withRegistryLock', () => {
  let dir: string;
  let lockFile: string;

  function writeForeignLock(ageMs: number, content = JSON.stringify({ pid: 424242, token: 'foreign', host: 'other-host', createdAt: 'x' })): void {
    writeFileSync(lockFile, content);
    const when = new Date(Date.now() - ageMs);
    utimesSync(lockFile, when, when);
  }

  function tokenOnDisk(): string {
    return (JSON.parse(readFileSync(lockFile, 'utf8')) as { token: string }).token;
  }

  async function exclusiveWork(): Promise<number> {
    let active = 0;
    let maxActive = 0;
    const work = async (): Promise<void> => {
      await withRegistryLock(
        dir,
        async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await sleep(15);
          active--;
        },
        { retryMs: 5 },
      );
    };
    await Promise.all(Array.from({ length: 6 }, work));
    return maxActive;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-sdk-lock-'));
    lockFile = lockFilePath(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('holds a lock file with pid, token, host and createdAt while fn runs, then removes it', async () => {
    let content: Record<string, unknown> = {};
    const result = await withRegistryLock(dir, (lock) => {
      content = JSON.parse(readFileSync(lockFile, 'utf8')) as Record<string, unknown>;
      expect(content['token']).toBe(lock.token);
      return 'done';
    });
    expect(result).toBe('done');
    expect(content['pid']).toBe(process.pid);
    expect(String(content['token'])).toMatch(new RegExp(`^${process.pid}-[0-9a-f]+$`));
    expect(typeof content['host']).toBe('string');
    expect(Number.isNaN(Date.parse(String(content['createdAt'])))).toBe(false);
    expect(existsSync(lockFile)).toBe(false);
  });

  it('creates the registry directory on first use', async () => {
    const nested = join(dir, 'nested', 'registry');
    await withRegistryLock(nested, () => undefined);
    expect(existsSync(nested)).toBe(true);
    expect(readdirSync(nested)).toEqual([]);
  });

  it('releases the lock and propagates the error when fn throws', async () => {
    await expect(
      withRegistryLock(dir, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(lockFile)).toBe(false);
  });

  it('awaits an async fn', async () => {
    const value = await withRegistryLock(dir, async () => {
      await sleep(20);
      return 7;
    });
    expect(value).toBe(7);
  });

  it('times out on a live lock with an actionable error, and leaves the foreign lock alone', async () => {
    writeForeignLock(1000);
    const waits: LockWaitInfo[] = [];
    const error = await withRegistryLock(dir, () => 'never', { timeoutMs: 200, retryMs: 20, onWait: (info) => waits.push(info) }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LockTimeoutError);
    const message = (error as Error).message;
    expect(message).toContain(lockFile);
    expect(message).toContain('pid 424242');
    expect(message).toMatch(/age \d+(\.\d+)?s/);
    expect(message).toMatch(/delete the lock file/);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits[0]).toMatchObject({ pid: 424242, stale: false, lockFile });
    expect(waits[0]!.ageMs).toBeGreaterThanOrEqual(1000);
    expect(tokenOnDisk()).toBe('foreign');
  });

  it('takes over a stale lock (mtime older than 30 s), reporting it through onWait', async () => {
    writeForeignLock(40_000);
    const waits: LockWaitInfo[] = [];
    let ran = false;
    await withRegistryLock(
      dir,
      () => {
        ran = true;
      },
      { onWait: (info) => waits.push(info) },
    );
    expect(ran).toBe(true);
    expect(waits.map((w) => w.stale)).toEqual([true]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('takes over a stale lock whose content is unreadable', async () => {
    writeForeignLock(40_000, '');
    await expect(withRegistryLock(dir, () => 'ok')).resolves.toBe('ok');
  });

  it('honors a custom staleMs', async () => {
    writeForeignLock(2000);
    await expect(withRegistryLock(dir, () => 'ok', { staleMs: 1000 })).resolves.toBe('ok');
  });

  it('serializes concurrent holders of the same directory', async () => {
    expect(await exclusiveWork()).toBe(1);
  });

  it('lets only one waiter win a stale lock', async () => {
    writeForeignLock(40_000);
    expect(await exclusiveWork()).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('touches the lock while fn runs so a long operation is not seen as stale', async () => {
    let initial = 0;
    let advanced = false;
    await withRegistryLock(
      dir,
      async () => {
        initial = statSync(lockFile).mtimeMs;
        // The guard only protects against a hang; the heartbeat (staleMs / 3) normally fires within a few hundred ms.
        const guard = Date.now() + 20_000;
        while (Date.now() < guard && !advanced) {
          await sleep(20);
          advanced = statSync(lockFile).mtimeMs > initial;
        }
      },
      { staleMs: 600 },
    );
    expect(advanced).toBe(true);
  });

  it('assertHeld throws LockLostError when the lock file now carries another token, and release keeps the foreign lock', async () => {
    const error = await withRegistryLock(dir, (lock) => {
      writeFileSync(lockFile, JSON.stringify({ pid: 1, token: 'thief', host: 'h', createdAt: 'x' }));
      lock.assertHeld();
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LockLostError);
    expect((error as Error).message).toMatch(/lock lost.*retry/s);
    expect(tokenOnDisk()).toBe('thief');
  });

  it('assertHeld throws LockLostError when the lock file disappeared', async () => {
    await expect(
      withRegistryLock(dir, (lock) => {
        rmSync(lockFile);
        lock.assertHeld();
      }),
    ).rejects.toBeInstanceOf(LockLostError);
  });

  it('a write guarded by assertHeld leaves the target untouched when the lock was lost', async () => {
    const target = join(dir, 'registry.json');
    writeFileSync(target, 'original');
    await expect(
      withRegistryLock(dir, (lock) => {
        writeFileSync(lockFile, JSON.stringify({ pid: 1, token: 'thief', host: 'h', createdAt: 'x' }));
        writeFileAtomic(target, 'overwritten', { beforeRename: lock.assertHeld });
      }),
    ).rejects.toBeInstanceOf(LockLostError);
    expect(readFileSync(target, 'utf8')).toBe('original');
    expect(readdirSync(dir).sort()).toEqual(['registry.json', 'registry.lock']);
  });

  it('creates the lock with a fresh mtime', async () => {
    await withRegistryLock(dir, () => {
      expect(Date.now() - statSync(lockFile).mtimeMs).toBeLessThan(5000);
    });
  });
});
