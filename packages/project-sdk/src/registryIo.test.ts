import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistryCorruptError, UnsupportedSchemaVersionError } from './errors.js';
import { withRegistryLock } from './lock.js';
import { REGISTRY_SCHEMA_VERSION, deletedFilePath, loadDeleted, loadRegistry, registryFilePath, saveDeleted, saveRegistry } from './registryIo.js';
import { makeProject, makeRegistry } from './testHelpers.js';

describe('registry files', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-sdk-io-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  it('names the files inside the registry directory', () => {
    expect(registryFilePath(dir)).toBe(join(dir, 'registry.json'));
    expect(deletedFilePath(dir)).toBe(join(dir, 'deleted_projects.json'));
  });

  describe('loadRegistry', () => {
    it('returns an empty registry for a missing file without creating it', () => {
      expect(loadRegistry(dir)).toEqual({ schemaVersion: 1, projects: [] });
      expect(readdirSync(dir)).toEqual([]);
    });

    it('returns an empty registry when the directory itself is missing', () => {
      expect(loadRegistry(join(dir, 'nope'))).toEqual({ schemaVersion: 1, projects: [] });
    });

    it('reads a saved registry back', async () => {
      const registry = makeRegistry(makeProject(1, { git: 'x', parent: undefined }));
      await withRegistryLock(dir, (lock) => saveRegistry(dir, registry, lock));
      expect(loadRegistry(dir)).toEqual(registry);
    });

    it('does not run the full validation on read (duplicates load fine)', () => {
      const dup = makeRegistry(makeProject(1, { name: 'same' }), makeProject(2, { name: 'same' }));
      writeFileSync(registryFilePath(dir), JSON.stringify(dup));
      expect(loadRegistry(dir).projects).toHaveLength(2);
    });

    it('fails on invalid JSON, naming the file', () => {
      writeFileSync(registryFilePath(dir), '{ not json');
      const run = () => loadRegistry(dir);
      expect(run).toThrow(RegistryCorruptError);
      expect(run).toThrow(registryFilePath(dir));
      expect(run).toThrow(/not valid JSON/);
    });

    it('fails with UnsupportedSchemaVersionError on another schemaVersion, with the data and the advice to upgrade', () => {
      writeFileSync(registryFilePath(dir), JSON.stringify({ schemaVersion: 2, projects: [] }));
      const error = (() => {
        try {
          loadRegistry(dir);
        } catch (e) {
          return e as UnsupportedSchemaVersionError;
        }
        throw new Error('expected an error');
      })();
      expect(error).toBeInstanceOf(UnsupportedSchemaVersionError);
      expect(error).not.toBeInstanceOf(RegistryCorruptError);
      expect(error).toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION', file: registryFilePath(dir), found: 2, supported: REGISTRY_SCHEMA_VERSION });
      expect(error.message).toMatch(/schemaVersion 2.*supports 1.*upgrade @wadeck-app\/project-sdk and @wadeck-app\/project-cli/s);
    });

    it('applies to deleted_projects.json too, and a missing schemaVersion is reported as found undefined', () => {
      writeFileSync(deletedFilePath(dir), JSON.stringify({ schemaVersion: 3, projects: [] }));
      expect(() => loadDeleted(dir)).toThrow(UnsupportedSchemaVersionError);
      writeFileSync(registryFilePath(dir), JSON.stringify({ projects: [] }));
      expect(() => loadRegistry(dir)).toThrow(UnsupportedSchemaVersionError);
    });

    it('exposes the supported version', () => {
      expect(REGISTRY_SCHEMA_VERSION).toBe(1);
    });

    it.each([
      ['not an object', '[]'],
      ['projects not an array', JSON.stringify({ schemaVersion: 1, projects: {} })],
      ['project without a name', JSON.stringify({ schemaVersion: 1, projects: [{ id: 'aaaaaaaa', aliases: [], paths: [], createdAt: 'x' }] })],
      ['aliases not strings', JSON.stringify({ schemaVersion: 1, projects: [{ id: 'aaaaaaaa', name: 'a', aliases: [1], paths: [], createdAt: 'x' }] })],
      ['bad path entry', JSON.stringify({ schemaVersion: 1, projects: [{ id: 'aaaaaaaa', name: 'a', aliases: [], paths: [{ path: 'x' }], createdAt: 'x' }] })],
      ['parent not a string', JSON.stringify({ schemaVersion: 1, projects: [{ id: 'aaaaaaaa', name: 'a', aliases: [], paths: [], parent: 3, createdAt: 'x' }] })],
    ])('fails on a wrong shape: %s', (_title, content) => {
      writeFileSync(registryFilePath(dir), content);
      expect(() => loadRegistry(dir)).toThrow(RegistryCorruptError);
    });
  });

  describe('deleted projects', () => {
    it('is empty when the file is missing', () => {
      expect(loadDeleted(dir)).toEqual({ schemaVersion: 1, projects: [] });
      expect(existsSync(deletedFilePath(dir))).toBe(false);
    });

    it('round-trips entries with deletedAt', async () => {
      const deleted = { schemaVersion: 1 as const, projects: [{ ...makeProject(1), deletedAt: '2026-10-25T00:00:00.000Z' }] };
      await withRegistryLock(dir, (lock) => saveDeleted(dir, deleted, lock));
      expect(loadDeleted(dir)).toEqual(deleted);
    });

    it('requires deletedAt', () => {
      writeFileSync(deletedFilePath(dir), JSON.stringify({ schemaVersion: 1, projects: [makeProject(1)] }));
      expect(() => loadDeleted(dir)).toThrow(/deletedAt/);
    });

    it('fails on invalid JSON, naming the deleted file', () => {
      writeFileSync(deletedFilePath(dir), 'oops');
      expect(() => loadDeleted(dir)).toThrow(/deleted_projects\.json/);
    });
  });

  describe('save', () => {
    it('writes indented JSON with a trailing newline', async () => {
      const registry = makeRegistry(makeProject(1));
      await withRegistryLock(dir, (lock) => saveRegistry(dir, registry, lock));
      expect(readFileSync(registryFilePath(dir), 'utf8')).toBe(`${JSON.stringify(registry, null, 2)}\n`);
    });
  });
});
