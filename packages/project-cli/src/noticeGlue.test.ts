import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateManager } from '@wadeck-app/shared-cli';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { showUpdateNotice } from './noticeGlue.js';

describe('showUpdateNotice', () => {
  let dir: string;
  let written: string[];
  let warnings: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-cli-notice-'));
    written = [];
    warnings = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const stateFile = () => join(dir, 'update-state.json');
  const writeState = (state: Record<string, unknown>) => writeFileSync(stateFile(), JSON.stringify(state));
  const show = (argv: string[]) =>
    showUpdateNotice({ configDir: dir, argv, manager: new UpdateManager('@wadeck-app/project-cli', dir), print: (line) => written.push(line), warn: (m) => warnings.push(m) });
  const success = { status: 'success', currentVersion: '1', targetVersion: '2', previousVersion: '1', timestamp: 1000 };

  it('leaves the update state alone for cli rollback, which needs its previousVersion, and prints no notice', () => {
    writeState(success);
    show(['cli', 'rollback']);
    expect(written).toEqual([]);
    expect(JSON.parse(readFileSync(stateFile(), 'utf8'))).toEqual(success);
    expect(existsSync(join(dir, 'update-notice-shown.json'))).toBe(false);
  });

  it('recognizes cli rollback after global options', () => {
    writeState(success);
    show(['--json', '-p', 'shop', 'cli', 'rollback']);
    expect(existsSync(stateFile())).toBe(true);
    expect(written).toEqual([]);
  });

  it('prints the notice of a successful update once and keeps the state, so cli rollback can still use it', () => {
    writeState(success);
    show(['list']);
    expect(written).toEqual(['[project] Updated to v2 (was v1). To go back: project cli rollback']);
    expect(JSON.parse(readFileSync(stateFile(), 'utf8'))).toEqual(success);
    show(['list']);
    expect(written).toHaveLength(1);
  });

  it('announces the next update again, whatever the state of the previous one', () => {
    writeState(success);
    show(['list']);
    writeState({ ...success, targetVersion: '3', previousVersion: '2', timestamp: 2000 });
    show(['list']);
    expect(written).toEqual(['[project] Updated to v2 (was v1). To go back: project cli rollback', '[project] Updated to v3 (was v2). To go back: project cli rollback']);
  });

  it.each([
    ['failed', { status: 'failed', error: 'npm install failed', timestamp: 1 }, '[project] Background update failed (npm install failed). Run: project cli update'],
    ['rolled-back', { status: 'rolled-back', targetVersion: '2', previousVersion: '1', timestamp: 1 }, '[project] Update to v2 failed (self-check failed). Rolled back to v1. Run: project cli logs'],
  ])('prints a %s update once and clears it, as before', (_status, state, line) => {
    writeState(state);
    show(['list']);
    expect(written).toEqual([line]);
    expect(existsSync(stateFile())).toBe(false);
  });

  it('prints nothing without a state, or with an unreadable one', () => {
    show(['list']);
    writeFileSync(stateFile(), '{oops');
    show(['list']);
    expect(written).toEqual([]);
  });

  it('warns, once the notice was shown, when it cannot remember that', () => {
    writeState(success);
    mkdirSyncAt(join(dir, 'update-notice-shown.json'));
    show(['list']);
    expect(written).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^warning: could not remember that the update notice was shown \(.+\)$/);
  });
});

function mkdirSyncAt(path: string): void {
  // A folder where the sidecar file should be makes writing it fail.
  mkdirSync(path);
}

describe('showUpdateNotice with a state that has no timestamp', () => {
  it('still announces it, since it cannot be told apart from the one already shown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'project-cli-notice-'));
    try {
      writeFileSync(join(dir, 'update-state.json'), JSON.stringify({ status: 'success', targetVersion: '2' }));
      const written: string[] = [];
      const deps = { configDir: dir, argv: ['list'], manager: new UpdateManager('@wadeck-app/project-cli', dir), print: (line: string) => written.push(line), warn: () => undefined };
      showUpdateNotice(deps);
      showUpdateNotice(deps);
      expect(written).toEqual(['[project] Updated to v2', '[project] Updated to v2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('showUpdateNotice with an update that is being applied', () => {
  let dir: string;
  let written: string[];
  const NOW = 10_000_000;
  const MIN = 60_000;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-cli-notice-'));
    written = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const stateFile = () => join(dir, 'update-state.json');
  const applying = (extra: Record<string, unknown> = {}) => ({ status: 'applying', currentVersion: '1', previousVersion: '1', targetVersion: '2', pid: 4242, timestamp: NOW - MIN, ...extra });
  const show = (alive: boolean, argv: string[] = ['list']) =>
    showUpdateNotice({
      configDir: dir,
      argv,
      manager: new UpdateManager('@wadeck-app/project-cli', dir),
      print: (line) => written.push(line),
      warn: () => undefined,
      isPidAlive: () => alive,
      now: () => NOW,
    });
  const INTERRUPTED = '[project] An update to v2 was interrupted (previous version v1). Repair it with: project cli update';

  it('says nothing while the updater that applies it is alive and the state is recent', () => {
    writeFileSync(stateFile(), JSON.stringify(applying()));
    show(true);
    expect(written).toEqual([]);
    expect(JSON.parse(readFileSync(stateFile(), 'utf8')).status).toBe('applying');
  });

  it('reports an interrupted update when the pid is dead, once, and keeps the state for the updater to repair', () => {
    writeFileSync(stateFile(), JSON.stringify(applying()));
    show(false);
    show(false);
    expect(written).toEqual([INTERRUPTED]);
    expect(JSON.parse(readFileSync(stateFile(), 'utf8')).status).toBe('applying');
  });

  it('reports it when the state is older than 15 minutes, even if the pid looks alive (pid reuse)', () => {
    writeFileSync(stateFile(), JSON.stringify(applying({ timestamp: NOW - 16 * MIN })));
    show(true);
    expect(written).toEqual([INTERRUPTED]);
  });

  it('with no pid in the state, only its age tells: recent says nothing, old reports', () => {
    writeFileSync(stateFile(), JSON.stringify(applying({ pid: undefined })));
    show(false);
    expect(written).toEqual([]);
    writeFileSync(stateFile(), JSON.stringify(applying({ pid: undefined, timestamp: NOW - 20 * MIN })));
    show(false);
    expect(written).toEqual([INTERRUPTED]);
  });

  it('a new interrupted state is reported again; the repaired result takes over afterwards', () => {
    writeFileSync(stateFile(), JSON.stringify(applying()));
    show(false);
    writeFileSync(stateFile(), JSON.stringify(applying({ timestamp: NOW - 2 * MIN, targetVersion: '3' })));
    show(false);
    expect(written).toEqual([INTERRUPTED, '[project] An update to v3 was interrupted (previous version v1). Repair it with: project cli update']);
    writeFileSync(stateFile(), JSON.stringify({ status: 'rolled-back', targetVersion: '3', previousVersion: '1', timestamp: NOW }));
    show(false);
    expect(written[2]).toContain('Rolled back to v1');
  });

  it('is skipped for cli rollback, like the other statuses', () => {
    writeFileSync(stateFile(), JSON.stringify(applying()));
    show(false, ['cli', 'rollback']);
    expect(written).toEqual([]);
  });
});
