/**
 * Whether a process with this pid exists. `process.kill(pid, 0)` sends nothing: EPERM means the process exists but belongs to
 * someone else (alive), ESRCH means it does not. Any other failure is not an answer and is not swallowed.
 */
export function isPidAlive(pid: number, kill: (pid: number, signal: 0) => unknown = process.kill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      return true;
    }
    if (code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}
