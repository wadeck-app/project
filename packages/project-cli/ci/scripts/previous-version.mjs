/**
 * The published version just before a given one, for the update test of the CI (verify-update.sh).
 * Run locally:  npm view @wadeck-app/project-cli versions --json | node ci/scripts/previous-version.mjs <version>
 * Prints the previous version, or nothing when there is none.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// What CI stamps: YYYY.M.D-NNN-<hex>. Anything else (0.0.1, other schemes) is not part of the update history.
const CALVER = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-(\d+)-[0-9a-f]+$/;

function numbers(version) {
  const match = CALVER.exec(version);
  return match === null ? undefined : match.slice(1, 5).map(Number);
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/**
 * `versions` is what `npm view <pkg> versions --json` prints (an array, or a string when there is a single version).
 * Versions are ordered by date then build number, not by the order npm lists them.
 */
export function previousVersion(versions, version) {
  const wanted = numbers(version);
  if (wanted === undefined) {
    throw new Error(`'${version}' is not a CalVer version (YYYY.M.D-NNN-sha): pass the version that was just published`);
  }
  const older = [versions]
    .flat()
    .map((candidate) => ({ candidate, parts: numbers(candidate) }))
    .filter((entry) => entry.parts !== undefined && compare(entry.parts, wanted) < 0)
    .sort((a, b) => compare(a.parts, b.parts));
  return older.at(-1)?.candidate;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (version === undefined) {
    process.stderr.write('usage: node previous-version.mjs <version>   (the output of "npm view <pkg> versions --json" on stdin)\n');
    process.exit(2);
  }
  const previous = previousVersion(JSON.parse(readFileSync(0, 'utf8')), version);
  if (previous !== undefined) {
    process.stdout.write(`${previous}\n`);
  }
}
