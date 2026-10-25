import { describe, expect, it, vi } from 'vitest';
import { assertReleaseBuild, isStampedVersion, scheduleBackgroundUpdate } from './devBuild.js';

describe('isStampedVersion', () => {
  it.each(['2026.10.25-019-97c1ee11', '2026.1.2-003-deadbeef', '2099.12.31-1000-0123abcd'])('%s is a stamped release', (version) => {
    expect(isStampedVersion(version)).toBe(true);
  });

  it.each(['0.0.1', '0.0.0-local', '2026.10.25', '2026.10.25-019-97c1ee1', '2026.10.25-019-97C1EE11', '2026.10.25-19-97c1ee11', '2026.10.25-019-97c1ee11x', '', 'latest'])(
    '%j is a development build',
    (version) => {
      expect(isStampedVersion(version)).toBe(false);
    },
  );
});

describe('assertReleaseBuild', () => {
  it('lets a stamped build through', () => {
    expect(() => assertReleaseBuild('2026.10.25-019-97c1ee11', 'update')).not.toThrow();
  });

  it('refuses a development build, saying what it is and what to do instead', () => {
    const run = () => assertReleaseBuild('0.0.1', 'update');
    expect(run).toThrow(/development build \(version 0\.0\.1.*not a stamped release\)/s);
    expect(run).toThrow(/replace the global install/);
    expect(run).toThrow(/npm i -g @wadeck-app\/project-cli.*project cli update/s);
  });
});

describe('scheduleBackgroundUpdate', () => {
  const manager = () => ({ scheduleBackgroundUpdate: vi.fn() });

  it('schedules the update of a stamped build', () => {
    const updates = manager();
    expect(scheduleBackgroundUpdate({ version: '2026.10.25-019-97c1ee11', manager: updates as never, bundlePath: '/b/project.cjs', updaterName: 'project-updater.cjs' })).toBe(true);
    expect(updates.scheduleBackgroundUpdate).toHaveBeenCalledWith('/b/project.cjs', 'project-updater.cjs');
  });

  it('never schedules it for a development build, a bundle with a local version included: it would touch the global install', () => {
    const updates = manager();
    expect(scheduleBackgroundUpdate({ version: '0.0.0-local', manager: updates as never, bundlePath: '/b/project.cjs', updaterName: 'project-updater.cjs' })).toBe(false);
    expect(updates.scheduleBackgroundUpdate).not.toHaveBeenCalled();
  });
});
