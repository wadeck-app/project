import { describe, expect, it } from 'vitest';
import { generateId, isIdLike } from './ids.js';

describe('isIdLike', () => {
  it('accepts exactly 8 lowercase hex chars', () => {
    expect(isIdLike('3fa9c1d2')).toBe(true);
    expect(isIdLike('3FA9C1D2')).toBe(false);
    expect(isIdLike('3fa9c1d')).toBe(false);
    expect(isIdLike('3fa9c1d2a')).toBe(false);
    expect(isIdLike('3fa9c1dg')).toBe(false);
  });
});

describe('generateId', () => {
  it('returns 8 lowercase hex chars from real randomness', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId(() => false)));
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(ids.size).toBe(50);
  });

  it('regenerates while the candidate is taken', () => {
    const candidates = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
    let calls = 0;
    const id = generateId((candidate) => candidate !== 'cccccccc', () => candidates[calls++]!);
    expect(id).toBe('cccccccc');
    expect(calls).toBe(3);
  });

  it('fails loudly instead of looping forever when every candidate is taken', () => {
    expect(() => generateId(() => true, () => 'aaaaaaaa')).toThrow(/could not generate a free project id/);
  });
});
