// Entry point of the updater, bundled separately as project-updater.cjs. It must NOT import the CLI runtime (size limit, see ci/scripts/bundle.ts).
import { realUpdaterDeps, updaterConfigDir } from './updater/realDeps.js';
import { runProjectUpdater } from './updater/runProjectUpdater.js';

// Injected by esbuild (define) in ci/scripts/bundle.ts; the updater is only ever built that way.
declare const __PROJECT_CLI_VERSION__: string | undefined;

if (typeof __PROJECT_CLI_VERSION__ !== 'string' || __PROJECT_CLI_VERSION__ === '') {
  process.stderr.write('[project-updater] fatal: this updater was built without a version (BUNDLE_VERSION); rebuild it with: npm run bundle\n');
  process.exit(1);
}

runProjectUpdater(realUpdaterDeps(process.env, updaterConfigDir(process.env), __PROJECT_CLI_VERSION__)).then((code) => {
  process.exitCode = code;
});
