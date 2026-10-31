import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the PACKAGED manifest of the app-module can be, in order: `app-module/` next to project.cjs (bundle
 * layout, the content of app-module-project's dist-module), else the dist-module of the sibling package of a
 * source checkout. The source manifest.json is never a candidate: app-core refuses it (no version, no
 * backendEntryPath); only `app-core-cli package` makes a registrable one.
 *
 * `baseDir` is the folder the running code sits in: dist-bundle (esbuild rewrites import.meta.url to project.cjs),
 * or dist / src in a checkout, which are one level below project-cli like dist-bundle is.
 */
export function appModuleManifestCandidates(baseDir: string): [string, string] {
  return [
    path.join(baseDir, 'app-module', 'manifest.json'),
    path.join(baseDir, '..', '..', 'app-module-project', 'dist-module', 'manifest.json'),
  ];
}

/** The manifest to register. Throws, naming every place it looked and how to produce it, when there is none. */
export function resolveAppModuleManifest(baseDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = appModuleManifestCandidates(baseDir);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `No app-module manifest found. Looked for ${candidates[0]} (installed package) and ${candidates[1]} (source checkout). ` +
        'An installed package should ship one: reinstall with `project cli update`. In a source checkout build it with: ' +
        'BUNDLE_VERSION=0.0.0-local npm run bundle --workspace=packages/app-module-project'
    );
  }
  return found;
}
