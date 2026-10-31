import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appCoreBaseUrl } from './appCore.js';

function configDirWith(portFile?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'project-module-appcore-'));
  mkdirSync(dir, { recursive: true });
  if (portFile !== undefined) {
    writeFileSync(join(dir, 'server.port.json'), portFile);
  }
  return dir;
}

describe('appCoreBaseUrl', () => {
  it('uses APP_CORE_PORT first', () => {
    const env = { APP_CORE_PORT: '4999', APP_CORE_CONFIG_DIR: configDirWith(JSON.stringify({ pid: 1, port: 4861 })) };
    expect(appCoreBaseUrl(env)).toBe('http://127.0.0.1:4999');
  });

  it('then the port app-core wrote for itself', () => {
    expect(appCoreBaseUrl({ APP_CORE_CONFIG_DIR: configDirWith(JSON.stringify({ pid: 1, port: 4861 })) })).toBe('http://127.0.0.1:4861');
  });

  it('then 4850', () => {
    expect(appCoreBaseUrl({ APP_CORE_CONFIG_DIR: configDirWith() })).toBe('http://127.0.0.1:4850');
    expect(appCoreBaseUrl({ APP_CORE_CONFIG_DIR: configDirWith('not json') })).toBe('http://127.0.0.1:4850');
  });

  it('refuses a malformed APP_CORE_PORT instead of calling another port', () => {
    expect(() => appCoreBaseUrl({ APP_CORE_PORT: 'abc', APP_CORE_CONFIG_DIR: configDirWith() })).toThrow(/APP_CORE_PORT/);
  });
});
