import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGuard, diffFingerprints, fingerprintTree, realConfigDir } from './guardRealConfig.js';

// A throwaway "real home": the guard is never tested on the real folder.
let home: string;
let realDir: string;
let markers: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'project-guard-test-'));
  realDir = join(home, '.config', 'project');
  markers = join(home, 'markers');
  mkdirSync(markers, { recursive: true });
  mkdirSync(join(realDir, 'app-module', '2026.10.31-024-abc'), { recursive: true });
  mkdirSync(join(realDir, 'projects', '64f4ae91'), { recursive: true });
  mkdirSync(join(realDir, 'logs'), { recursive: true });
  writeFileSync(join(realDir, 'app-module', '2026.10.31-024-abc', 'manifest.json'), '{"id":"project"}');
  writeFileSync(join(realDir, 'registry.json'), '{}');
  writeFileSync(join(realDir, 'update-state.json'), '{}');
  writeFileSync(join(realDir, 'logs', '2026-10-31.ndjson'), '');
});
afterEach(() => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

const guard = (dir = realDir) => createGuard({ realDir: dir, lastTestFile: join(markers, 'last.txt'), startedFilesFile: join(markers, 'started.txt') });

function message(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the guard did not fail');
}

describe('realConfigDir', () => {
  it('is $XDG_CONFIG_HOME/project when set, else <home>/.config/project', () => {
    expect(realConfigDir({ XDG_CONFIG_HOME: join('x', 'cfg') }, 'h')).toBe(join('x', 'cfg', 'project'));
    expect(realConfigDir({}, join('h'))).toBe(join('h', '.config', 'project'));
    expect(realConfigDir({ XDG_CONFIG_HOME: '  ' }, join('h'))).toBe(join('h', '.config', 'project'));
  });
});

describe('fingerprintTree', () => {
  it('lists everything under the folder recursively, with the kind, the size and the time', () => {
    const tree = fingerprintTree(realDir)!;
    expect([...tree.keys()].sort()).toEqual(
      ['app-module', 'app-module/2026.10.31-024-abc', 'app-module/2026.10.31-024-abc/manifest.json', 'logs', 'logs/2026-10-31.ndjson', 'projects', 'projects/64f4ae91', 'registry.json', 'update-state.json'].sort(),
    );
    expect(tree.get('registry.json')).toMatchObject({ kind: 'file', size: 2 });
    expect(tree.get('app-module')!.kind).toBe('dir');
  });

  it('is undefined for a folder that does not exist', () => {
    expect(fingerprintTree(join(home, 'nope'))).toBeUndefined();
  });
});

describe('diffFingerprints', () => {
  it('names removed, added and changed paths', () => {
    const before = fingerprintTree(realDir)!;
    rmSync(join(realDir, 'app-module'), { recursive: true });
    writeFileSync(join(realDir, 'new.json'), 'x');
    writeFileSync(join(realDir, 'registry.json'), '{"projects":[]}');
    expect(diffFingerprints(before, fingerprintTree(realDir)!)).toEqual(
      expect.arrayContaining(['removed: app-module', 'removed: app-module/2026.10.31-024-abc', 'removed: app-module/2026.10.31-024-abc/manifest.json', 'added: new.json', expect.stringContaining('changed: registry.json')]),
    );
  });

  it('is empty when nothing differs', () => {
    expect(diffFingerprints(fingerprintTree(realDir)!, fingerprintTree(realDir)!)).toEqual([]);
  });
});

describe('the guard of a test run', () => {
  it('passes when nothing changed', () => {
    const g = guard();
    g.start();
    expect(() => g.finish()).not.toThrow();
  });

  it('FAILS when the staged module of the real app-core was removed (the incident), naming the path and the test that ran last', () => {
    writeFileSync(join(markers, 'last.txt'), 'C:/repo/packages/project-cli/src/AppCoreRegistration.test.ts :: attemptUnregistration removes the staged copies');
    writeFileSync(join(markers, 'started.txt'), 'a.test.ts\nC:/repo/packages/project-cli/src/AppCoreRegistration.test.ts\n');
    const g = guard();
    g.start();
    rmSync(join(realDir, 'app-module'), { recursive: true });
    const text = message(() => g.finish());
    expect(text).toContain('CHANGED THE REAL CONFIGURATION FOLDER');
    expect(text).toContain('removed: app-module/2026.10.31-024-abc/manifest.json');
    expect(text).toContain('Last test that started: C:/repo/packages/project-cli/src/AppCoreRegistration.test.ts :: attemptUnregistration removes the staged copies');
    expect(text).toContain('project cli register');
  });

  it.each([
    ['a file of the registry is rewritten', () => writeFileSync(join(realDir, 'registry.json'), '{"projects":[1]}')],
    ['an update file is touched', () => utimesSync(join(realDir, 'update-state.json'), new Date(0), new Date(1000))],
    ['a log line is appended', () => writeFileSync(join(realDir, 'logs', '2026-10-31.ndjson'), 'a line')],
    ['a project folder is added', () => mkdirSync(join(realDir, 'projects', 'deadbeef'))],
    ['a project folder is removed', () => rmSync(join(realDir, 'projects', '64f4ae91'), { recursive: true })],
    ['a new top-level file appears', () => writeFileSync(join(realDir, 'oops.txt'), '')],
  ])('FAILS when %s', (_name, change) => {
    const g = guard();
    g.start();
    change();
    expect(() => g.finish()).toThrow(/CHANGED THE REAL CONFIGURATION FOLDER/);
  });

  it('FAILS when the whole folder disappears', () => {
    const g = guard();
    g.start();
    rmSync(realDir, { recursive: true });
    expect(message(() => g.finish())).toContain('was removed');
  });

  it('with no real folder, passes while it stays absent and FAILS if the run creates it', () => {
    const absent = join(home, 'absent', 'project');
    const g = guard(absent);
    g.start();
    expect(() => g.finish()).not.toThrow();
    const created = guard(absent);
    created.start();
    mkdirSync(absent, { recursive: true });
    expect(message(() => created.finish())).toContain('did not exist when the run started and exists now');
  });

  it('says so when no test reported itself', () => {
    const g = guard();
    g.start();
    writeFileSync(join(realDir, 'oops.txt'), '');
    expect(message(() => g.finish())).toContain('(no test reported itself)');
  });
});
