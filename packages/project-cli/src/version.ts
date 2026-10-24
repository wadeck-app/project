import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** package.json sits next to `dist/` (and next to `src/` in tests). */
const PACKAGE_JSON = new URL('../package.json', import.meta.url);

/** Version of the CLI, read from its package.json at runtime. Fails loudly: there is no default version. */
export function readVersion(file: URL = PACKAGE_JSON): string {
  const path = fileURLToPath(file);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof SyntaxError ? `${path} is not valid JSON: ${error.message}` : (error as Error).message;
    throw new Error(`cannot read the version of the project CLI from ${path} (${reason}); reinstall the CLI`);
  }
  const version = (value as { version?: unknown } | null)?.version;
  if (typeof version !== 'string' || version === '') {
    throw new Error(`cannot read the version of the project CLI: ${path} has no "version" string; reinstall the CLI`);
  }
  return version;
}
