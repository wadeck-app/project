import { describe, expect, it } from 'vitest';
import { significantStderr } from './testHelpers.js';

describe('significantStderr', () => {
  it('drops npm warnings and node deprecation noise, keeps real errors', () => {
    const text = 'npm warn Unknown user config "always-auth".\n(node:1) [DEP0040] DeprecationWarning: x\n(Use `node --trace-deprecation ...` to show where the warning was created)\nreal error\n';
    expect(significantStderr(text)).toBe('real error');
  });

  it('is empty when there was only noise, and keeps a line that merely mentions npm warn', () => {
    expect(significantStderr('npm warn x\r\n')).toBe('');
    expect(significantStderr('failed (npm warn inside)')).toBe('failed (npm warn inside)');
  });
});
