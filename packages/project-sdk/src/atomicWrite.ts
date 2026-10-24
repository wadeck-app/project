import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { AtomicWriteError } from './errors.js';

const RENAME_ATTEMPTS = 10;
const RENAME_BACKOFF_MS = 20;
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export interface AtomicWriteOptions {
  /** Called after the temp file is durable, right before the rename; throw to abort without touching the target. */
  beforeRename?: () => void;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function removeQuietly(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // The temp file is already gone or unremovable; the original error is what matters to the caller.
  }
}

// Windows can refuse a rename for a moment (antivirus, indexer, a reader): retry a few times, then fail loudly.
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      const transient = process.platform === 'win32' && code !== undefined && TRANSIENT_RENAME_CODES.has(code);
      if (!transient || attempt >= RENAME_ATTEMPTS) {
        throw error;
      }
      sleepSync(RENAME_BACKOFF_MS * attempt);
    }
  }
}

function toWriteError(file: string, error: unknown): AtomicWriteError {
  return new AtomicWriteError(
    `cannot write ${file} (${errorCode(error) ?? 'unknown error'}: ${error instanceof Error ? error.message : String(error)}); check that the directory exists, is writable and that no other program locks the file, then retry`,
  );
}

function writeTemp(file: string, temp: string, content: string): void {
  const fd = openSync(temp, 'wx');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Writes a file so readers never see a partial content: temp file in the same directory, fsync, rename over the target. */
export function writeFileAtomic(file: string, content: string, options: AtomicWriteOptions = {}): void {
  const temp = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeTemp(file, temp, content);
  } catch (error) {
    removeQuietly(temp);
    throw toWriteError(file, error);
  }
  try {
    options.beforeRename?.();
  } catch (error) {
    removeQuietly(temp);
    throw error;
  }
  try {
    renameWithRetry(temp, file);
  } catch (error) {
    removeQuietly(temp);
    throw toWriteError(file, error);
  }
}
