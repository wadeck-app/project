import { describe, expect, it } from 'vitest';
import { updateNoticeLines } from './updateNotice.js';

const base = { timestamp: 1 };

describe('updateNoticeLines', () => {
  it('says nothing when there is no state or the update is still being applied', () => {
    expect(updateNoticeLines(null)).toEqual([]);
    expect(updateNoticeLines({ ...base, status: 'applying' })).toEqual([]);
  });

  it('announces the version a background update installed', () => {
    expect(updateNoticeLines({ ...base, status: 'success', targetVersion: '2026.10.25-001-abc' })).toEqual(['[project] Updated to v2026.10.25-001-abc']);
    expect(updateNoticeLines({ ...base, status: 'success', newVersion: '2026.10.25-002-abc' })).toEqual(['[project] Updated to v2026.10.25-002-abc']);
  });

  it('tells about a rollback and where to look', () => {
    expect(updateNoticeLines({ ...base, status: 'rolled-back', targetVersion: '2', previousVersion: '1' })).toEqual([
      '[project] Update to v2 failed (self-check failed). Rolled back to v1. Run: project cli logs',
    ]);
  });

  it('reports a failed update with its reason and how to retry in the foreground', () => {
    expect(updateNoticeLines({ ...base, status: 'failed', error: 'npm root -g failed' })).toEqual([
      '[project] Background update failed (npm root -g failed). Run: project cli update',
    ]);
  });

  it('does not hide a failure that came without a reason', () => {
    expect(updateNoticeLines({ ...base, status: 'failed' })).toEqual(['[project] Background update failed (no reason recorded). Run: project cli update']);
  });
});
