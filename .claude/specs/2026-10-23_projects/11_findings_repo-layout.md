# Repo layout, CI and release of the existing CLIs (R-9, R-10)

Source: research agent report 2026-10-24. Spot-checked by project-owner against: `queue-sdk/package.json`, `queue/package.json`, `compute-version/action.yml` (date format, dist tags), `task-cli/ci/scripts/bundle.ts` (BUNDLE_VERSION check). The rest is NOT re-verified. Repos: `task`, `queue`, `app-core`; flow lives in `agent-fleet/packages/flow-cli`.

## Layout to copy

| Item | Model |
|---|---|
| Root | private, `type: module`, `workspaces: ["packages/*"]`, ordered explicit `build`/`test`, `preversion: npm test`, node >=22 (queue/task root `package.json`) |
| SDK package | `queue-sdk`: ESM by tsc into `dist/esm`, CJS by esbuild into `dist/cjs` (`ci/build-cjs.mjs`), `exports` with types/import/require, `publishConfig` GitHub Packages public, no `dependencies`, TS ^7, vitest ^4 |
| CLI package | private; published as generated `project-cli-dist` + 3 platform packages; `ci/scripts/{bundle.ts,build-launcher.mjs,copy-binaries.sh,generate-platform-packages.sh}`, `ci/templates/bin-launcher.js.tmpl`, `ci/launcher-<cli>.config.json`, `src/<cli>-updater-entry.ts` (updater bundle <= 500 KB) |
| Architecture rules | task: `architecture/rules.ts` + test run by `test:architecture`; queue has none |
| CI | `.github/workflows/publish.yml`: `npm ci`, build, test, `wadeck-app/ci-templates/.github/actions/compute-version@main`, `BUNDLE_VERSION` env on bundle, `npm pkg set version=` on dist + platform packages, publish with `--tag dist_tag`; checkout needs `fetch-depth: 0`; queue adds a cross-platform SDK test matrix |
| Version | CalVer `YYYY.M.D-NNN-sha8` from the action (unpadded month/day); dist tags `latest` or `breaking-edge` (no `edge`) |
| SDK pin | consumers use `"latest"` (task-cli, flow); queue/orchestrator use CalVer ranges. Decision #18: `"latest"` |

## Pitfalls to avoid (verified or agent-reported)

| Pitfall | Where | Our rule |
|---|---|---|
| Silent fallback when `BUNDLE_VERSION` is unset | queue `bundle.ts` (agent-reported); task refuses to build (verified) | Refuse to build, like task |
| Self-check silently skipped when `npm root -g` fails | task, queue updater entries (agent-reported) | Fail loudly |
| flow checks `'update-failed'`, UpdateManager normalizes to `failed` | flow, orchestrator (agent-reported) | Use `failed` |
| `npm install` in CI | queue (agent-reported) | `npm ci` |
| No tests in publish pipeline | flow (agent-reported) | Run tests before publish |
| Per-repo copies of `bin-launcher.js.tmpl` / `generate-platform-packages.sh` drift from ci-templates | task, queue, agent-fleet (agent-reported) | Decide at CLI scaffold: canonical copy or documented deviations |
| Zero-padded date in `ci-templates/scripts/compute-version.sh` vs unpadded in the action | ci-templates (agent-reported) | Use the action |

## Notes

- The CLI auto-update stack (UpdateManager in `shared-cli`, `shared-updater` repo, bin launcher, platform packages) is only needed for `project-cli`, not for `project-sdk`.
- The SDK is scaffolded first (Decision #18: `project-sdk` first).
