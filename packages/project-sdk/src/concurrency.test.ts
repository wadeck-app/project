import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { significantStderr } from './testHelpers.js';
import { loadRegistry } from './registryIo.js';
import { validateRegistry } from './validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const builtEntry = join(here, '..', 'dist', 'esm', 'index.js');

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runChild(script: string, args: string[]): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, '__fixtures__', script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('concurrent writers in separate processes', () => {
  let registryDir: string;
  let root: string;

  beforeEach(() => {
    // These tests drive the BUILT package from real child processes: a missing build is a failure, never a skip.
    if (!existsSync(builtEntry)) {
      throw new Error(`${builtEntry} is missing: run 'npm run build' before 'npm test' (the multi-process tests import the compiled package)`);
    }
    root = mkdtempSync(join(tmpdir(), 'project-sdk-concurrency-'));
    registryDir = join(root, 'registry');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  it('keeps every project when two processes add 20 projects each, while a third reads without lock', async () => {
    const [a, b, reader] = await Promise.all([
      runChild('writer.mjs', [registryDir, 'alpha', '20']),
      runChild('writer.mjs', [registryDir, 'beta', '20']),
      runChild('reader.mjs', [registryDir, '300']),
    ]);

    for (const result of [a, b, reader]) {
      expect(significantStderr(result.stderr)).toBe('');
      expect(result.code).toBe(0);
    }
    const registry = loadRegistry(registryDir);
    expect(registry.projects).toHaveLength(40);
    expect(new Set(registry.projects.map((p) => p.name)).size).toBe(40);
    expect(new Set(registry.projects.map((p) => p.id)).size).toBe(40);
    expect(() => validateRegistry(registry, { checkPaths: true })).not.toThrow();
    expect(readdirSync(registryDir).sort()).toEqual(['registry.json']);
  });
});
