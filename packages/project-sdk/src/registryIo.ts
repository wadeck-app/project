import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomicWrite.js';
import { RegistryCorruptError, UnsupportedSchemaVersionError } from './errors.js';
import type { LockHandle } from './lock.js';
import type { DeletedProject, DeletedRegistry, Project, Registry } from './types.js';

/** The only schemaVersion of registry.json and deleted_projects.json this version reads and writes. */
export const REGISTRY_SCHEMA_VERSION = 1;

export function registryFilePath(registryDir: string): string {
  return join(registryDir, 'registry.json');
}

export function deletedFilePath(registryDir: string): string {
  return join(registryDir, 'deleted_projects.json');
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function projectProblem(value: unknown, withDeletedAt: boolean): string | undefined {
  if (!isRecord(value)) {
    return 'is not an object';
  }
  for (const key of ['id', 'name', 'createdAt'] as const) {
    if (typeof value[key] !== 'string') {
      return `has no string '${key}'`;
    }
  }
  if (withDeletedAt && typeof value['deletedAt'] !== 'string') {
    return "has no string 'deletedAt'";
  }
  if (!isStringArray(value['aliases'])) {
    return "has no 'aliases' array of strings";
  }
  const paths = value['paths'];
  if (!Array.isArray(paths) || !paths.every((p) => isRecord(p) && typeof p['path'] === 'string' && typeof p['main'] === 'boolean')) {
    return "has no 'paths' array of { path: string, main: boolean }";
  }
  if (value['labels'] !== undefined && !isStringArray(value['labels'])) {
    return "has a 'labels' that is not an array of strings";
  }
  for (const key of ['parent', 'git'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      return `has a non-string '${key}'`;
    }
  }
  return undefined;
}

function parseStore(file: string, text: string, withDeletedAt: boolean): unknown[] {
  const fix = `fix or restore ${file} (a backup, or delete it only if you accept to lose the projects it lists)`;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new RegistryCorruptError(`${file} is not valid JSON (${(error as Error).message}); ${fix}`);
  }
  if (!isRecord(value) || !Array.isArray(value['projects'])) {
    throw new RegistryCorruptError(`${file} has an unexpected shape: expected { "schemaVersion": ${REGISTRY_SCHEMA_VERSION}, "projects": [...] }; ${fix}`);
  }
  if (value['schemaVersion'] !== REGISTRY_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(
      `${file} has schemaVersion ${String(value['schemaVersion'])} but this version supports ${REGISTRY_SCHEMA_VERSION}; upgrade @wadeck-app/project-sdk and @wadeck-app/project-cli`,
      { file, found: value['schemaVersion'], supported: REGISTRY_SCHEMA_VERSION },
    );
  }
  value['projects'].forEach((entry, index) => {
    const problem = projectProblem(entry, withDeletedAt);
    if (problem !== undefined) {
      throw new RegistryCorruptError(`${file}: project #${index + 1} ${problem}; ${fix}`);
    }
  });
  return value['projects'];
}

function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new RegistryCorruptError(`${file} cannot be read (${(error as Error).message}); check its permissions`);
  }
}

/** Loads registry.json. A missing file is the legitimate first-use state: an empty registry, nothing is created. No lock, no full validation. */
export function loadRegistry(registryDir: string): Registry {
  const file = registryFilePath(registryDir);
  const text = readIfPresent(file);
  if (text === undefined) {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, projects: [] };
  }
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, projects: parseStore(file, text, false) as Project[] };
}

/** Loads deleted_projects.json (empty when missing). */
export function loadDeleted(registryDir: string): DeletedRegistry {
  const file = deletedFilePath(registryDir);
  const text = readIfPresent(file);
  if (text === undefined) {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, projects: [] };
  }
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, projects: parseStore(file, text, true) as DeletedProject[] };
}

function save(file: string, value: Registry | DeletedRegistry, lock: LockHandle): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { beforeRename: lock.assertHeld });
}

/** Atomically writes registry.json; the caller must hold the lock (checked again right before the rename). */
export function saveRegistry(registryDir: string, registry: Registry, lock: LockHandle): void {
  save(registryFilePath(registryDir), registry, lock);
}

/** Atomically writes deleted_projects.json; the caller must hold the lock. */
export function saveDeleted(registryDir: string, deleted: DeletedRegistry, lock: LockHandle): void {
  save(deletedFilePath(registryDir), deleted, lock);
}
