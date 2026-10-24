import { randomBytes } from 'node:crypto';
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { LockLostError, LockTimeoutError } from './errors.js';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_RETRY_MS = 50;
const NOTIFY_EVERY_MS = 1000;
const CHECK_ATTEMPTS = 5;
const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export interface LockOptions {
  /** A lock whose mtime is older than this is stale and can be taken over. Default 30000. */
  staleMs?: number;
  /** Total time to wait for a held lock before LockTimeoutError. Default 35000. */
  timeoutMs?: number;
  /** Delay between two attempts. Default 50. */
  retryMs?: number;
  /** Called when the lock is found held (first time, then at most once per second); the SDK prints nothing itself. */
  onWait?: (info: LockWaitInfo) => void;
}

export interface LockWaitInfo {
  lockFile: string;
  /** Pid of the holder, undefined when the lock content is unreadable. */
  pid: number | undefined;
  ageMs: number;
  stale: boolean;
}

export interface LockHandle {
  token: string;
  /** Throws LockLostError unless the lock file still carries this holder's token. */
  assertHeld: () => void;
}

interface LockContent {
  pid: number;
  token: string;
  host: string;
  createdAt: string;
}

interface LockSnapshot {
  raw: string;
  mtimeMs: number;
  content: LockContent | undefined;
}

export function lockFilePath(registryDir: string): string {
  return join(registryDir, 'registry.lock');
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function isTransient(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && TRANSIENT_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseContent(raw: string): LockContent | undefined {
  try {
    const value = JSON.parse(raw) as Partial<LockContent> | null;
    if (value !== null && typeof value === 'object' && typeof value.pid === 'number' && typeof value.token === 'string') {
      return value as LockContent;
    }
  } catch {
    // Unreadable content is reported as "unknown holder"; staleness is decided by mtime alone.
  }
  return undefined;
}

/** Undefined when the lock does not exist, 'busy' when it cannot be read right now (transient on Windows). */
function readSnapshot(file: string): LockSnapshot | undefined | 'busy' {
  try {
    const mtimeMs = statSync(file).mtimeMs;
    const raw = readFileSync(file, 'utf8');
    return { raw, mtimeMs, content: parseContent(raw) };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return undefined;
    }
    if (isTransient(error)) {
      return 'busy';
    }
    throw error;
  }
}

/** Creates the lock file exclusively. False when it exists (or is momentarily unavailable on Windows). */
function tryCreate(file: string, content: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (error) {
    if (errorCode(error) === 'EEXIST' || isTransient(error)) {
      return false;
    }
    throw error;
  }
  try {
    writeSync(fd, content);
  } catch (error) {
    closeSync(fd);
    unlinkSync(file);
    throw error;
  }
  closeSync(fd);
  return true;
}

function removeIfPresent(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Atomic stale takeover: move the lock away, then check that what was moved is exactly the stale lock that was observed.
 * Several waiters can race: only one rename succeeds, and a lock that is not the observed stale one is put back, never deleted.
 */
function takeOverStale(file: string, observed: LockSnapshot, staleMs: number): boolean {
  const displaced = `${file}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    renameSync(file, displaced);
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || isTransient(error)) {
      return false;
    }
    throw error;
  }
  const moved = readSnapshot(displaced);
  if (moved !== undefined && moved !== 'busy' && moved.raw === observed.raw && Date.now() - moved.mtimeMs > staleMs) {
    removeIfPresent(displaced);
    return true;
  }
  try {
    // A hard link fails when a new lock already exists, unlike a rename which would overwrite it.
    linkSync(displaced, file);
    removeIfPresent(displaced);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
    // A new lock was created meanwhile; the displaced file is left in place (named registry.lock.stale-*) for manual inspection.
  }
  return false;
}

function holderLabel(snapshot: LockSnapshot): string {
  const pid = snapshot.content === undefined ? 'unknown' : String(snapshot.content.pid);
  const host = snapshot.content === undefined ? '' : ` on host ${snapshot.content.host}`;
  return `pid ${pid}${host}`;
}

function timeoutError(file: string, snapshot: LockSnapshot | undefined, timeoutMs: number): LockTimeoutError {
  const who = snapshot === undefined ? 'a holder that just released it' : holderLabel(snapshot);
  const age = snapshot === undefined ? 'n/a' : `${((Date.now() - snapshot.mtimeMs) / 1000).toFixed(1)}s`;
  return new LockTimeoutError(
    `timed out after ${timeoutMs} ms waiting for the registry lock ${file}, held by ${who} (age ${age}); ` +
      `if that process is still working, wait for it and retry; if it is gone, check the process and delete the lock file ${file}`,
  );
}

interface AcquireOptions extends Required<Omit<LockOptions, 'onWait'>> {
  onWait: LockOptions['onWait'];
}

async function acquire(file: string, content: string, options: AcquireOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let lastNotify = 0;
  let lastSnapshot: LockSnapshot | undefined;
  for (;;) {
    if (tryCreate(file, content)) {
      return;
    }
    const snapshot = readSnapshot(file);
    if (snapshot !== undefined && snapshot !== 'busy') {
      lastSnapshot = snapshot;
      const ageMs = Date.now() - snapshot.mtimeMs;
      const stale = ageMs > options.staleMs;
      if (options.onWait !== undefined && Date.now() - lastNotify >= NOTIFY_EVERY_MS) {
        lastNotify = Date.now();
        options.onWait({ lockFile: file, pid: snapshot.content?.pid, ageMs, stale });
      }
      if (stale && takeOverStale(file, snapshot, options.staleMs)) {
        continue;
      }
    }
    if (snapshot === undefined) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw timeoutError(file, lastSnapshot, options.timeoutMs);
    }
    await sleep(options.retryMs);
  }
}

function ownsLock(file: string, token: string): boolean {
  for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt++) {
    const snapshot = readSnapshot(file);
    if (snapshot !== 'busy') {
      return snapshot?.content?.token === token;
    }
  }
  throw new LockLostError(`lock lost: cannot read ${file} to confirm this process still holds it; nothing was written, retry the command`);
}

function release(file: string, token: string): void {
  if (ownsLock(file, token)) {
    removeIfPresent(file);
  }
}

/**
 * Runs `fn` while holding the registry write lock (`<registryDir>/registry.lock`), creating the directory when needed.
 * Waiting is silent: pass `onWait` to show progress. The lock is touched periodically while `fn` runs.
 */
export async function withRegistryLock<T>(registryDir: string, fn: (lock: LockHandle) => T | Promise<T>, options: LockOptions = {}): Promise<T> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  mkdirSync(registryDir, { recursive: true });
  const file = lockFilePath(registryDir);
  const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const content: LockContent = { pid: process.pid, token, host: hostname(), createdAt: new Date().toISOString() };
  await acquire(file, JSON.stringify(content), {
    staleMs,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryMs: options.retryMs ?? DEFAULT_RETRY_MS,
    onWait: options.onWait,
  });
  // A failed touch is retried on the next tick (staleMs/3 leaves room for two retries); a lock really lost is caught by assertHeld.
  const heartbeat = setInterval(() => {
    try {
      if (ownsLock(file, token)) {
        const now = new Date();
        utimesSync(file, now, now);
      }
    } catch {
      // See above: the next tick retries.
    }
  }, staleMs / 3);
  heartbeat.unref();
  const handle: LockHandle = {
    token,
    assertHeld: () => {
      if (!ownsLock(file, token)) {
        throw new LockLostError(
          `lock lost: ${file} is no longer held by this process (another process took it over after ${staleMs} ms without a touch, or the file was deleted); ` +
            'nothing was written, retry the command',
        );
      }
    },
  };
  try {
    return await fn(handle);
  } finally {
    clearInterval(heartbeat);
    release(file, token);
  }
}
