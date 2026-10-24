import { describe, expect, it } from 'vitest';
import { selfChecks } from './selfChecks.js';

describe('selfChecks', () => {
  it('has named checks that all pass on a working install, without touching the real registry', async () => {
    const results = await Promise.all(selfChecks().map((check) => check()));
    expect(results.map((r) => r.name)).toEqual(['Version', 'Registry (temp)', 'Reference resolution (temp)']);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });
});
