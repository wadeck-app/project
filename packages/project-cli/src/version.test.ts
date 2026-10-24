import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readVersion } from './version.js';

describe('readVersion', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-cli-version-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function fileWith(content: string): URL {
    const file = join(dir, 'package.json');
    writeFileSync(file, content);
    return pathToFileURL(file);
  }

  it('reads the version of the package next to the compiled code by default', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads the version field of the given file', () => {
    expect(readVersion(fileWith('{"version":"1.2.3"}'))).toBe('1.2.3');
  });

  it('fails loudly when the file is missing, naming it', () => {
    const missing = pathToFileURL(join(dir, 'nope.json'));
    expect(() => readVersion(missing)).toThrow(/cannot read the version of the project CLI from .*nope\.json/);
  });

  it('fails loudly when the file is not JSON', () => {
    expect(() => readVersion(fileWith('{oops'))).toThrow(/package\.json.*not valid JSON/);
  });

  it('fails loudly when there is no version string', () => {
    expect(() => readVersion(fileWith('{"name":"x"}'))).toThrow(/package\.json has no "version" string/);
  });
});
