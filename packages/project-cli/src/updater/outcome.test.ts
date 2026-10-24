import { describe, expect, it } from 'vitest';
import { describeOutcome } from './outcome.js';

const files = { cacheFile: '/cfg/update-cache.json', stateFile: '/cfg/update-state.json' };
const input = { currentVersion: '1', startedAt: 1000, cache: null, state: null, ...files };

describe('describeOutcome', () => {
  it('always states the current version, the latest known one and the status', () => {
    expect(describeOutcome({ ...input, cache: { lastCheckedAt: 2000, latestVersion: '1' } })).toEqual([
      '[project-updater] current: 1',
      '[project-updater] latest:  1',
      '[project-updater] status:  up to date',
    ]);
  });

  it('reports the terminal state written by this run', () => {
    const status = (state: Record<string, unknown>) =>
      describeOutcome({ ...input, state: { currentVersion: '1', timestamp: 1500, ...state } as never, cache: { lastCheckedAt: 1500, latestVersion: '2' } })[2];
    expect(status({ status: 'success', targetVersion: '2' })).toBe('[project-updater] status:  updated to 2');
    expect(status({ status: 'failed', error: 'npm install failed' })).toBe('[project-updater] status:  update failed -- npm install failed');
    expect(status({ status: 'rolled-back', previousVersion: '1' })).toBe('[project-updater] status:  update rolled back to 1 -- the new version failed its self-check');
    expect(status({ status: 'deferred', retryAt: 1500 + 120_000 })).toBe('[project-updater] status:  deferred -- will retry automatically in 2 minutes');
  });

  it('prefers the state of this run over an older state left by a previous run', () => {
    const lines = describeOutcome({ ...input, state: { status: 'failed', currentVersion: '1', timestamp: 500, error: 'old' }, cache: { lastCheckedAt: 1500, latestVersion: '1' } });
    expect(lines[2]).toBe('[project-updater] status:  up to date');
  });

  it('names the status it does not know instead of guessing', () => {
    const lines = describeOutcome({ ...input, state: { status: 'update-available', currentVersion: '1', timestamp: 1500 } });
    expect(lines[2]).toBe("[project-updater] status:  unexpected state 'update-available' in /cfg/update-state.json");
  });

  it('says where it looked when this run left no trace (version fetch failed, another run holds the lock)', () => {
    const lines = describeOutcome(input);
    expect(lines[1]).toBe('[project-updater] latest:  unknown (no cache file)');
    expect(lines[2]).toBe(
      '[project-updater] status:  unknown -- this run wrote neither /cfg/update-cache.json nor /cfg/update-state.json (the version check failed or another update is running); see: project cli logs',
    );
  });
});
