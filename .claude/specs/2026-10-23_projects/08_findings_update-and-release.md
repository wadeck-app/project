# 08 - Findings: auto-update and release/distribution pattern

Scope: task, queue, flow-cli, shared-updater, shared-cli, ci-templates, singleton-daemon-kit; siblings checked: orchestrator, violations, app-core, scrapers, wdrive.
Read-only. "unknown" = not verified. Paths relative to C:\Workspace_Tooling unless absolute.

Reading warning: the global docs in C:\Users\Wadeck\.claude\docs\cli\ (auto-update.md, ci.md, config.md) and the skill wadeck-npm are STALE (GitLab registry, `edge` dist-tag, `bundle-updater` step, `.update.lock`, `update-log.txt`). Do not copy from them. Truth = code below.

## 1. shared-updater (`shared-updater/`)

- Package `@wadeck-app/shared-updater`, ESM + CJS dual build, zero runtime deps (package.json devDependencies only; CLAUDE.md + .claude/guiding-principles.md).
- Published to GitHub Packages (`publishConfig` `@wadeck-app:registry=https://npm.pkg.github.com/`, `access: public`; package.json:14-17).
- API (src/index.ts:1-20): `runUpdater(cfg)`, `runWithoutDaemon`, `runWithDaemon`, `fetchLatestVersion`, `readState/writeState`, `readCache/writeCache`, `tryAcquireLock/releaseLock`, `readUpdateConfig`, `semverLte`, `execNpm`, `appendLog`, `stateFilePath/cacheFilePath/lockFilePath`.
- Config (src/types.ts): `pkgName`, `configDir`, `currentVersion`, `strategy` (`without-daemon` | `with-daemon`), `skipThrottle?`, and for without-daemon: `onUpdateAvailable?`, `npmInstallFlags?`, `restartDaemon?{portFile,healthTokenFile}`.
- What the host CLI must provide:

| Need | Where / how | Evidence |
|---|---|---|
| Separate updater bundle `<cli>-updater.cjs` | esbuild entry importing ONLY shared-updater + shared-cli/ConfigDir (+ app-core registration for task/queue/flow) | task `src/task-updater-entry.ts:1-3`, queue `src/cli/queue-updater-entry.ts:1-3` |
| `<500 KB` guard, "free of the CLI runtime" | build-time throw in the bundler script, NOT a test and NOT in shared-updater | task `ci/scripts/bundle.ts:16,80-86`; queue `ci/scripts/bundle-updater.ts:16,42-48` and `bundle.ts:10,112`; flow `ci/scripts/bundle.ts:19,124` |
| Version stamp | esbuild `define` `__<CLI>_CLI_VERSION__` = `BUNDLE_VERSION` env | task `bundle.ts:23-26`; updater falls back to `'0.0.0-dev'` (`task-updater-entry.ts:42`) |
| `configDir` | `ConfigDir.get(name)` = `~/.config/<name>` (XDG_CONFIG_HOME respected) | shared-cli `ConfigDir.ts:5-12` |
| `config.yml` keys read by regex | `channel:` (default `latest`), `checkInterval:` (`30m`, `ms|s|m|h|d`, default 30 min), `autoUpdate: false` | `shared-updater/src/shared/config.ts:1-30` |
| Self-check command | env `UPDATER_SELF_CHECK_CMD` = `node <npm root -g>/<pkg>/<cli>.cjs cli self-check`; unset = self-check passes | `without-daemon.ts:193-206`; set by each entry (task entry:44-53) |
| `<cli> cli self-check` subcommand | `runSelfCheck` from shared-cli, exit 1 on failure, `CLI_SELF_CHECK_QUIET=1` | shared-cli `SelfCheck.ts:19-40` |
| Files written in configDir | `update-state.json`, `update-cache.json`, `update.lock` (JSON {pid,ts}, stale 10 min), `logs/YYYY-MM-DD.ndjson` | `state.ts:16-26`, `lock.ts`, `log.ts` |
| Daemon files (only if restartDaemon / with-daemon) | `config.port` (JSON {port}), `health_token`, writes `config.restart` then POST `/quit` | `without-daemon.ts:149-191`, `with-daemon.ts:70-95` |

- Flow of `runWithoutDaemon` (without-daemon.ts:12-147): lock -> read config (autoUpdate:false returns unless `UPDATER_FORCE=1`, both cases logged, :27-37) -> throttle on `cache.lastCheckedAt` vs `checkIntervalMs` (bypass: `UPDATER_FORCE=1`, `skipThrottle`, deferred `retryAt` due; :55) -> `npm view <pkg> dist-tags.<channel>` (30 s, no `--registry` flag, so relies on user npm config; fetch.ts) -> `semverLte(latest,current)` -> optional `onUpdateAvailable` (`apply-now` | `{defer,retryIn}` writes state `deferred`) -> `npm install -g <pkg>@<exact latest>` (5 min) -> self-check -> rollback `npm install -g <pkg>@<current>` on failure -> state `success|failed|rolled-back` -> optional daemon restart.
- `with-daemon` strategy never installs; writes state `update-available`, POST `/quit` only when forced (`with-daemon.ts`). No CLI in the checked set uses it (grep: all entries use `strategy: 'without-daemon'`; wdrive/app-core not verified).
- `semverLte` splits on `[-.]` and `Number()`s each part; the sha segment becomes NaN and is ignored (semver.ts). Docs say "do not replace with a semver library" (guiding-principles).
- Drift: shared-updater guiding-principles says cache default 4h; code default is 30 min (config.ts). README documents `checkIntervalMs` / `disabled` keys; code reads `checkInterval` / `autoUpdate` (README.md:30-36 vs config.ts:12-15).

## 2. Trigger of the update check

| Aspect | Fact | Evidence |
|---|---|---|
| Every run? | Yes: `scheduleBackgroundUpdate` in a `finally`/after-command, spawns `node <cli>-updater.cjs` detached, `stdio:'ignore'`, `windowsHide`, `unref` | shared-cli `UpdateManager.ts:31-47`; task `TaskIndex.ts:101-103` (NOT in finally: skipped if `runTaskCommand` throws before it, main().catch exits); queue `QueueIndex.ts:1479-1481` (finally); flow `FlowIndex.ts:296-301` (finally); violations `cli.ts:901-904` (finally, skipped when `userConfig.update.disabled`) |
| Throttled? | Yes by `checkInterval` (default 30 min) via `update-cache.json`; check time is recorded after the fetch succeeded (cache not written on fetch failure) | without-daemon.ts:55-74 |
| No-op in dev | If no updater `.cjs` beside the bundle, returns silently (only dev-mode silence) | UpdateManager.ts:38-39 |
| Daemon-aware | flow: daemon and worker re-trigger on a timer at `checkIntervalMs` with `UPDATER_SKIP_THROTTLE=1` (`Daemon.ts:546-566`); updater defers while `work_in_flight` (`UpdateDeferral.ts`, retry 2 min). orchestrator: `skipThrottle:true` + `restartDaemon` + defers on active jobs. task/queue/violations: no daemon logic (`apply-now`) | flow `updater/entry.ts:243-261`; orchestrator `updater/entry.ts` |
| Restart of daemon after update | orchestrator: `config.restart` + POST /quit (shared-updater `restartDaemon`). queue/flow: daemon NOT restarted on update (comments in queue entry:41, flow entry:267). `config.update` sentinel: launcher supports it (`singleton-daemon-kit/go-launcher/launcher.go:241-262`, `updateCmd` whitelist `npm install -g @wadeck[-app]/<pkg>`), configured in orchestrator + wdrive `launcher.config.json`; orchestrator lessons-learned says nothing in orchestrator src writes `config.update` any more (only `config.restart`) | files cited |
| Task/queue launcher configs | `cliFlags: []`, no `updateCmd` | task `ci/launcher-task.config.json`, queue `ci/launcher-queue.config.json`; flow `ci/launcher.config.json` has cliFlags only |

## 3. Distribution channel and versions

- Registry: GitHub Packages (`https://npm.pkg.github.com`), scope `@wadeck-app`, `access: public`. Every workflow: `setup-node@v5` Node 24, `registry-url`, `scope`, token = `secrets.GITHUB_TOKEN`.
- Version: CalVer `YYYY.M.D-BBB-<sha8>`, e.g. installed `@wadeck-app/task-cli` = `2026.10.23-086-8f481ed5` (C:\App\nodejs\node_modules\@wadeck-app\task-cli\package.json). BBB = zero-padded `git rev-list --count HEAD`. Used composite action: `ci-templates/.github/actions/compute-version/action.yml:111-120` uses `date -u '+%Y.%-m.%-d'` (unpadded). The script `ci-templates/scripts/compute-version.sh:31` uses padded `%m.%d` and is NOT what workflows call (all 14 workflows call the action `@main`; grep). Lockfiles show unpadded (`2026.10.3-092-dad1ef6b`).
- Required CI behavior of that action: input `version` (workflow_dispatch) overrides to a stable semver; `breaking=true` => dist-tag `breaking-edge`, prerelease; else dist-tag `latest` (action.yml:126-132). So every push to main publishes under `latest`. `channel: latest` in config.yml means the updater follows `latest`; a user may set `channel: breaking-edge` (ChannelConfig).
- Published package layout for a CLI (generated, not in git): `@wadeck-app/<cli>-cli` (dist: `bin/<cli>.js`, `<cli>.cjs`, `<cli>-updater.cjs`, extras like `app-module/`, `optionalDependencies` on 3 platform packages with `>=0.0.0-0`) + `@wadeck-app/<cli>-cli-win32-x64|darwin-arm64|darwin-x64` (Go launcher binary). Source: `ci-templates/scripts/generate-platform-packages.sh:62-109`. The repo's own `<cli>-cli` workspace package is `private: true` (queue-cli/package.json, task-cli/package.json, flow-cli/package.json) and is never published.
- Publish order: platform packages first, then dist package (task workflow:110-122, queue:127-139, flow:98-110).
- Observed on this machine: installed `task-cli-win32-x64` is `2026.08.29-380-d9897e56` while `task-cli` is `2026.10.23-086`: the updater runs `npm install -g <pkg>@<ver>` and the `>=0.0.0-0` optionalDependency does not force the platform package up (observed, cause not proven).
- Pin policy for shared libs (consumers' package.json):

| Dependency | task-cli | queue-cli | flow-cli | orchestrator-cli |
|---|---|---|---|---|
| shared-updater | `latest` | `latest` | `latest` | `^2026.10.10-017-4e04d240` |
| shared-cli | devDep `^2026.10.11-040-8ddd428a` (bundled) | `latest` | `latest` | `^2026.10.3-035-1e4adce3` |
| singleton-daemon-kit | `latest` | `latest` | `latest` | `2026.10.11-094-73166e71` (exact) |
| app-core-sdk | `latest` | `^2026.10.22-072-f1ca3cff` | `latest` | `>=2026.10.22-075-f7ea6949` |
| queue-sdk | via task-service: exact `2026.10.24-185-58dde7dd` | workspace `*` | n/a | `>=2026.10.24-185-58dde7dd` |

  `^` on a CalVer prerelease is effectively an exact pin (skill wadeck-npm, semver prerelease rule; not re-verified). Effective versions come from package-lock.json: shared-updater is `2026.10.10-017-4e04d240` in task but `2026.8.31-010-0917c75e` in queue (lockfile grep), i.e. `latest` does not float, and repos drift. All runtime deps are inlined by esbuild (`external: []`), so the published dist package has no dependencies besides the platform optionalDependencies.

## 4. CI template / release workflow

- Per-repo workflow, copy-pasted (no repo calls the reusable `publish-npm.yml` from ci-templates; grep of workflows shows only the `compute-version` action used from ci-templates):
  - task `task/.github/workflows/publish.yml`: push/PR/dispatch; job build-and-test = `npm ci`, build, lint, test, build-launcher, compute-version, check app-module, bundle (`BUNDLE_VERSION`), generate-platform-packages, copy-binaries, `npm pkg set version` on 4 packages, upload artifact; job publish (`if push`) downloads and publishes.
  - queue `queue/.github/workflows/publish-queue-cli.yml`: uses `npm install --prefer-offline` (not `npm ci`), plus a 3-OS `sdk-cross-platform` job, publish in one job; also publishes `queue-sdk` last (:141-148).
  - flow `agent-fleet/.github/workflows/publish-flow-cli.yml`: triggers on `main` AND `integration` branches; NO test step (build only); publish has no `if` guard.
  - shared-updater: matrix test on ubuntu/windows/macos, `npm ci`, compute-version, `npm pkg set version`, `npm publish --tag`. shared-cli, singleton-daemon-kit similar (singleton-daemon-kit uses `npm version --no-git-tag-version`, publish.yml:67).
- Version injected at publish time only (`preversion` hook blocks local `npm version` outside CI: shared-updater package.json:46, singleton-daemon-kit package.json).
- Drift of copies: `bin-launcher.js.tmpl` and `generate-platform-packages.sh` copies in task, queue, agent-fleet all DIFFER from `ci-templates/` (diff -q). Local `compute-version.sh` copies (queue, agent-fleet, shared-updater) differ from the template; task has none. ci-templates CLAUDE.md says "never edit per-repo copies".
- Signing: NO release signing in task, queue, flow, shared-*, ci-templates (grep `signing`). `release_signing_key.pem`, `release_signing_key_pub.pem`, `release_signing_key.pem_b64` sit loose in C:\Workspace_Tooling root (outside any repo; contents not read). Only wdrive has an Ed25519 sign script (`wdrive/ci/scripts/sign-artifact.sh`, `RELEASE_SIGNING_KEY` secret, `wdrive/docs/operations/release-and-updater.md`); `sign-artifact` is not referenced in wdrive/.github (grep) and `RELEASE_PUBLIC_KEY_PEM` not found in wdrive/driver/src: wdrive signing looks vestigial (not verified further). npm path = no signature check, trust = GitHub Packages token.

## 5. Install / bootstrap layout

- Install: `npm install -g @wadeck-app/<cli>-cli` (needs `~/.npmrc` scope + PAT, not read here). Global prefix on this machine: `C:\App\nodejs` -> symlink to `C:\App\nvm\v24.11.1\`.
- Shims: `/c/App/nodejs/task` (sh), `task.cmd`, `task.ps1` exec `node <prefix>/node_modules/@wadeck-app/task-cli/bin/task.js`.
- Installed package dir: `bin/task.js`, `task.cjs`, `task-updater.cjs`, `app-module/`, `package.json`.
- `bin/task.js` (template `bin-launcher.js.tmpl`): resolves the platform package binary, auto-`npm install -g` if missing (template:19-37); bundle path = `__dirname/../<cli>.cjs`; on win32 runs node directly except `start`; otherwise execs the Go launcher with `LAUNCHER_BUNDLE_OVERRIDE`.
- How the CLI knows its version: constant baked at bundle time (`__TASK_CLI_VERSION__`, `src/version.ts:237-238`; dev fallback = generated string via git). The updater bundle has its own baked constant; fallback `0.0.0-dev`. Installed `package.json` version is the same string (set by CI).
- `resolveOwnBundlePath` guards a leaked `LAUNCHER_BUNDLE_OVERRIDE` from another CLI (shared-cli `resolveOwnBundlePath.ts`), warns on mismatch.
- Config dir: `~/.config/<cli>/` (`C:\Users\Wadeck\.config\task` seen: `config.yml` {autoUpdate: true, checkInterval: 30m}, `update-cache.json`, `logs/YYYY-MM-DD.ndjson`, stale `update-log.txt` from 2026-08-29).
- `UpdateManager` derives the config dir name from the package name: strip scope, strip `-cli` (`UpdateManager.ts:27`). For `@wadeck-app/project-cli` => `~/.config/project`.

## 6. User-facing UX

| Item | Fact | Evidence |
|---|---|---|
| Notice before output | `readAndClearState()` at top of command; stderr: `[task] Updated to v...`, rollback notice with `Run: task cli update --log`, failure notice | task `cli/updateNotice.ts`; queue `QueueIndex.ts:846-856`; flow `FlowIndex.ts:246-261` |
| Manual update | `<cli> cli update` runs the updater synchronously with `UPDATER_FORCE=1`, `stdio:inherit` (`CliMetaCommands.ts:117-137`); `--check` (version only), `--log`, `cli rollback` (task, flow), `cli version`, `cli self-check`, `cli logs [--follow]` | task `CliSubcommands.ts`; flow `CliCommand.ts:95-170`; queue `QueueIndex.ts:1157-1232` (no rollback, no `--check`/`--log`) |
| Outcome printed on manual update | task + flow entries mirror the NDJSON log lines and print `current / latest / status` when `UPDATER_FORCE=1` (task entry:55-166). queue: NOT done, `queue cli update` prints only "Running updater..." and the updater's own log goes to file | queue-updater-entry.ts (no echo code) |
| Opt-out | Only `autoUpdate: false` in `~/.config/<cli>/config.yml` (violations: `.violations/config.ts update.disabled`). No env var opt-out found (grep NO_UPDATE etc.: none). Dev env: `UPDATER_FORCE=1` (bypass), `UPDATER_SKIP_THROTTLE=1` (flow), `UPDATER_SELF_CHECK_CMD`, `CLI_SELF_CHECK_QUIET=1`, `<CLI>_CONFIG_DIR` (updater only) | files cited |
| autoUpdate:false honored but explained | shared-updater logs both the skip and a forced override (without-daemon.ts:27-37). task/flow additionally copy config to a temp dir with `autoUpdate: true` under `UPDATER_MANUAL=1` (task entry:26-40) - redundant since shared-updater already honors `UPDATER_FORCE`. orchestrator rewrites the user's config.yml and restores it (orchestrator entry:20-47) | |
| Failure behavior | Background run is detached, `stdio: ignore`: failures go to log file + `update-state.json` `failed`, surfaced on the NEXT command as a stderr notice. Version fetch failure and "already running" write only a log line, no state, so no notice (without-daemon.ts:66-72). Self-check unarmed (npm root -g failed) => task/queue/flow/violations proceed WITHOUT verification and without rollback (silent fallback, task entry:51-53, queue entry:26-28, flow entry:60-62, violations entry); orchestrator fails closed with a logged error (entry:55-85) |

## 7. Tests / rules enforcing the pattern

- shared-updater: unit + integration tests with a real `MockRegistry` HTTP server and real npm (`src/without-daemon.integration.test.ts`; `strategies/*.test.ts` cover install, rollback, lock, throttle, skipThrottle, autoUpdate:false, defer/retryAt, restartDaemon).
- Updater bundle size: enforced only by bundler scripts (build fails), not by a test. task CLAUDE.md states "updater bundle must stay under 500 KB and free of the task runtime".
- task `architecture/` (vitest, part of `npm test`): layering rules; `SHARED_CLI` regex bans `@wadeck-app/shared-(cli|updater)` from task-service and app-module-task (architecture/rules.ts:32,56,71). No rule about updater entry contents.
- `task-cli/src/configDirParity.test.ts`: task-service config dir equals `ConfigDir.get('task')`.
- queue `QueueCli.test.ts:135-156`: `cli update` error path and call to `cliUpdateCommand`.
- violations-rules (shared lint rules, `violations-framework/packages/violations-rules/src/rules/cli/`): `updater-strategy-missing-windows-hide` (Go files), `publishconfig-missing-access-public`, `no-spawn-without-windows-hide`, `daemon-spawn-no-windows-hide`.
- No test verifies that every CLI has: separate updater bundle, `cli self-check`, `finally` scheduling, notice reader. (not found by grep; "unknown" if hidden in other repos).

## 8. Checklist for a new CLI repo (`project`)

1. Workspace layout like queue: root `package.json` (private, workspaces), `packages/project-kit`, `packages/project-cli` (private), optional core.
2. `project-cli` bundler `ci/scripts/bundle.ts`: esbuild CJS, `external: []`, `define __PROJECT_CLI_VERSION__`, refuse to build when `BUNDLE_VERSION` unset (task/flow do; queue falls back to CalVer/package.json - do not copy), outputs `project.cjs` + `project-updater.cjs`, 500 KB guard on the updater.
3. `src/project-updater-entry.ts`: imports only `@wadeck-app/shared-updater` + `@wadeck-app/shared-cli/ConfigDir`; `PKG_NAME='@wadeck-app/project-cli'`; arm `UPDATER_SELF_CHECK_CMD` and fail closed if `npm root -g` fails (orchestrator model, not the silent skip); `strategy:'without-daemon'`; echo outcome when `UPDATER_FORCE=1` (task/flow model).
4. Main entry: `UpdateManager('@wadeck-app/project-cli').readAndClearState()` + stderr notice BEFORE command output (handle `success`, `rolled-back`, `failed`; note flow's `update-failed` check never matches, see 9); `scheduleBackgroundUpdate(bundlePath,'project-updater.cjs')` in `finally`; `resolveOwnBundlePath('project.cjs', ...)`; export `PROJECT_BUNDLE_NAME`.
5. Subcommands: `project cli version|update [--check]|rollback|self-check|logs`; `warnUnknownArgs`; do not add a `--log` that reads `update-log.txt` (nothing writes it; use `logs/<date>.ndjson`, i.e. `cli logs`).
6. `cli self-check` with in-process checks via `runSelfCheck`.
7. `config.yml` in `~/.config/project/`: `autoUpdate`, `checkInterval`, `channel`.
8. Go launcher config `ci/launcher-project.config.json` (`appName`, `nodeScript: project.cjs`, `defaultConfigDir: project`, `cliFlags: []`) built via singleton-daemon-kit `go-launcher/build.sh` (task `build-launcher.mjs`).
9. Packaging: copy `bin-launcher.js.tmpl` + `generate-platform-packages.sh` from ci-templates (call as `generate-platform-packages.sh project[:extra-file]`), `copy-binaries.sh`; dist `files` must list extras (e.g. a bundled kit file if any).
10. Workflow: copy task's `publish.yml` (build, lint, test, `npm ci`, compute-version action `wadeck-app/ci-templates/.github/actions/compute-version@main`, bundle with `BUNDLE_VERSION`, `npm pkg set version` on all 4 packages, publish platform packages then dist, `--tag dist_tag`). Add `project-kit` publish step like queue-sdk (`npm pkg set version=<same>`, `npm publish --tag`), with cross-OS test job if the kit runs on all machines.
11. `publishConfig` `{ "@wadeck-app:registry": "https://npm.pkg.github.com/", "access": "public" }` on every published package (violations rule enforces `access`), `repository.url` in package.json, `preversion` CI-only guard.
12. No signing step exists in the pattern (do not invent one; wdrive-only legacy).
13. Docs: CLAUDE.md with `.claude/{guiding-principles,out-of-scope,product-vision,threat-model}.md` like siblings; `.violations/config.ts`.

### Inconsistencies between task / queue / flow (all verified in code)

| # | Item | task | queue | flow |
|---|---|---|---|---|
| a | `BUNDLE_VERSION` unset | build error | falls back to CalVer / package.json | build error |
| b | Notice for failed update | handles `failed` | handles `failed` | checks `'update-failed'` (FlowIndex.ts:257), which UpdateManager normalizes to `failed` (UpdateManager.ts:55) so the notice never prints |
| c | Schedule trigger | after command, not in `finally` | `finally` | `finally`, + daemon/worker timers |
| d | `cli update` options/outcome print | `--check`, `--log`, outcome echo | none, no echo | `--check`, `--log`, `--drain`, outcome echo |
| e | `cli rollback` | yes | no | yes |
| f | `--log` | reads `update-log.txt` (stale since 2026-08-29; shared-updater never writes it) | n/a | same as task (CliCommand.ts:128) |
| g | autoUpdate:false bypass | `UPDATER_MANUAL` temp-config hack (redundant) | none (relies on `UPDATER_FORCE`) | `UPDATER_MANUAL` hack |
| h | CI | lint + test + app-module check; PR runs build | `npm install` not `npm ci`; 3-OS SDK job | no tests in workflow; publishes from `integration` too |
| i | Config dir env override | updater honors `TASK_CONFIG_DIR`; `UpdateManager` reader does not (ConfigDir only) | `QUEUE_CONFIG_DIR` same split | `FLOW_CONFIG_DIR` same split |
| j | Self-check unarmed | silent proceed | silent proceed | silent proceed |
| k | Local copies of ci-templates files | differ | differ | differ |

## 9. Second package (SDK/kit) precedent and versioning

- queue-sdk (`@wadeck-app/queue-sdk`, zero-dep, "never throws"): same repo, workspace package, built in the same job, published by the SAME workflow AFTER the CLI with the SAME computed version and dist-tag (`queue/.github/workflows/publish-queue-cli.yml:141-148`); repo package.json keeps placeholder `0.1.0`. Has `exports` ESM + CJS + `./protocol` + `./testing`, `files` incl. docs. Cross-platform test job (ubuntu/windows/macos) gates publish. Own protocol SemVer documented in queue CLAUDE.md.
- Consumption: queue-core/queue-cli use workspace `*`; task-service pins exact `2026.10.24-185-58dde7dd`; orchestrator-cli uses `>=2026.10.24-185-58dde7dd`. Consumers bundle it, so the pin matters at build time only. Because the SDK is published only when the CLI publish step succeeds, a failed CLI publish blocks the SDK (consequence of ordering, not documented).
- singleton-daemon-kit (zero-dep shared package consumed by flow-core, queue, task-cli, orchestrator, wdrive, scrapers): own repo + own workflow (`singleton-daemon-kit/.github/workflows/publish.yml`), version from the same compute-version action (CalVer, published as e.g. `2026.10.11-094-73166e71`), no peers/dist package; also ships Go sources used by consumers' `build-launcher` (resolves `build.sh` through `require.resolve('@wadeck-app/singleton-daemon-kit/package.json')`, task `build-launcher.mjs:20-23`). Consumers pin: `latest` (task, queue, flow-cli, flow-core), exact (orchestrator). Its CLAUDE.md claims version format `1.YYYYMMDDHHMMSS.BUILD` - contradicted by the workflow (stale doc). Its package.json uses `typescript ^5`, `vitest ^2`, publishConfig without `access: public` (violations rule `publishconfig-missing-access-public` would flag it; not run).
- shared-cli and shared-updater: own repos, same release mechanism, consumed as `latest` (lockfile decides); shared-cli exports many subpaths (`./ConfigDir`, `./UpdateManager`, `./CliMetaCommands`, ...) and is ESM + CJS.
- Implication for project-kit (facts only): the established precedent is "SDK in the same workspace, published in the CLI workflow with identical CalVer + dist-tag, consumers pin exact or `>=`/`^` of a published CalVer". Whether `project-kit` should live in the `project` repo (queue-sdk model) or its own repo (singleton-daemon-kit model) is a decision, not a fact. The `queue-sdk` pin split (exact vs `>=` vs workspace) shows no single pin policy exists.

## Open / unknown

- Contents of `~/.npmrc` (blocked by guardrail, not read): exact registry auth setup per machine unknown.
- Whether `npm install` (queue CI) re-resolves `latest` over the lockfile: unknown.
- Cause of the stale `task-cli-win32-x64` on this machine: unknown.
- wdrive signing actually used at runtime: unknown (see 4).
- Use of `with-daemon` strategy by wdrive/app-core: unknown.
