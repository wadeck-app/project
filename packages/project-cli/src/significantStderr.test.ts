import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bashCommand, removeTempDir, significantStderr } from './testHelpers.js';

describe('significantStderr (the stderr of a child process without the noise of npm and node)', () => {
  it('drops the warnings npm prints, whatever its config (setup-node writes an npmrc with an unknown key)', () => {
    const text = 'npm warn Unknown user config "always-auth". This will stop working in the next major version of npm.\nnpm warn Unknown project config "foo".\nreal error';
    expect(significantStderr(text)).toBe('real error');
  });

  it('drops the deprecation warnings of node and the hint that follows them', () => {
    const text = '(node:4321) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.\n(Use `node --trace-deprecation ...` to show where the warning was created)\nreal error';
    expect(significantStderr(text)).toBe('real error');
  });

  it('drops the lines of the debugger and of an experimental feature warning', () => {
    expect(significantStderr('Debugger attached.\nWaiting for the debugger to disconnect...\n(node:1) ExperimentalWarning: x\nok')).toBe('ok');
  });

  it('is empty when there was only noise', () => {
    expect(significantStderr('npm warn something\n')).toBe('');
  });

  it('keeps real errors, including a line that merely contains the word "npm warn"', () => {
    expect(significantStderr('error: spawn failed (npm warn is in the message)')).toBe('error: spawn failed (npm warn is in the message)');
    expect(significantStderr('npm error code E404\nnpm warn x')).toBe('npm error code E404');
  });

  it('keeps the order and the blank lines between real lines, and understands CRLF', () => {
    expect(significantStderr('a\r\nnpm warn x\r\n\r\nb\r\n')).toBe('a\n\nb');
  });
});

describe('removeTempDir (cleanup that cannot fail a test)', () => {
  it('removes the folder with its content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'project-cli-remove-'));
    writeFileSync(join(dir, 'a.txt'), 'x');
    removeTempDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('retries on its own: the removal asks for 20 retries 100 ms apart (EPERM / EBUSY on Windows)', () => {
    const remove = vi.fn();
    removeTempDir('/some/dir', { remove });
    expect(remove).toHaveBeenCalledWith('/some/dir', { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  it('after the retries, a failure is a warning naming the folder and the reason, not an error', () => {
    const warn = vi.fn();
    const remove = () => {
      throw new Error("EPERM: operation not permitted, rm 'x'");
    };
    expect(() => removeTempDir('/some/dir', { remove, warn })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('/some/dir');
    expect(warn.mock.calls[0]![0]).toContain('EPERM');
    expect(warn.mock.calls[0]![0]).toContain('delete it by hand');
  });
});

describe('bashCommand', () => {
  it('is plain bash outside Windows', () => {
    expect(bashCommand('linux', {}, () => true)).toBe('bash');
    expect(bashCommand('darwin', {}, () => true)).toBe('bash');
  });

  it('on Windows prefers the bash of Git over whatever `bash` resolves to (the WSL launcher)', () => {
    const gitBash = join('/fake/ProgramFiles', 'Git', 'bin', 'bash.exe');
    expect(bashCommand('win32', { ProgramFiles: '/fake/ProgramFiles' }, (path) => path === gitBash)).toBe(gitBash);
  });

  it('falls back to bash when Git is not where expected', () => {
    expect(bashCommand('win32', { ProgramFiles: '/fake/ProgramFiles' }, () => false)).toBe('bash');
  });
});
