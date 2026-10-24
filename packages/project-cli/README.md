# project-cli

The `project` command: register, inspect and resolve the projects shared by the task, flow and queue CLIs. Thin layer over `@wadeck-app/project-sdk` (registry location, rules and errors are defined there).

This workspace package is private. What is published as `@wadeck-app/project-cli` is generated from it (see Distribution).

## Install

Published on GitHub Packages. Once, in your user `.npmrc` (the token needs `read:packages`):

```
@wadeck-app:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<token>
```

Then `npm i -g @wadeck-app/project-cli` gives the `project` command (node >= 22). Installs of the earlier plain package upgrade the same way, once by hand; from this version on the CLI updates itself.

## Auto-update

After every command a detached background run checks the `latest` channel and installs a newer version with `npm install -g`. A new version must pass `project cli self-check` or it is rolled back. The next command prints a notice on stderr (`Updated to ...`, `rolled back`, or `Background update failed (...)`).

| Command | What it does |
|---|---|
| `project cli update` | Update now, ignoring the cache and `autoUpdate: false`; prints current, latest and status. `--check` only shows the available version |
| `project cli version` | Installed and available version |
| `project cli rollback` | Reinstall the version before the last update |
| `project cli logs [--follow]` | Today's updater log |
| `project cli self-check` | Health checks (temporary registry, nothing is written to yours) |

Settings in `<registry folder>/config.yml` (the updater keeps its state, cache and logs there, next to `registry.json`): `autoUpdate: false`, `channel: <dist-tag>`, `checkInterval: <30m|4h|...>`.

An update that cannot be verified is not attempted: if `npm root -g` fails, the run fails loudly (visible in `project cli update`, and as the failure notice of the next command).

## Usage

`project --help` lists the commands. `--project` / `-p <ref>` is accepted anywhere in argv; `--json` prints machine output on stdout. Default target of a command without `<ref>`: `--project`, then `PROJECT_PROJECT`, then the project containing the cwd.

`project remove` requires an explicit `<ref>` (no `--project`, no environment variable, no cwd): a destructive command never acts on an implicit target.

SDK errors are neutral; the CLI adds a `hint:` line with its own flags (`--recursive`, `--new-main`, `--name`) built from the error data, or carried by it (`NoProjectInScopeError.hint`).

stderr always carries one line stating how the registry and project were resolved; stdout stays clean for `--json`.

| Exit code | Meaning |
|---|---|
| 0 | success |
| 1 | `ProjectError` from the SDK, or a failed `cli` command (`error: <message>`) |
| 2 | usage error |
| 70 | unexpected exception (stack printed) |

## Distribution

Same stack as the task and queue CLIs. `npm run bundle` (esbuild, needs `BUNDLE_VERSION`, no default) makes `project.cjs` and `project-updater.cjs` (< 500 KB), with the SDK inlined: the published package has no runtime dependency. `ci/scripts/generate-platform-packages.sh project` generates `project-cli-dist` (published as `@wadeck-app/project-cli`, with the `bin/project.js` launcher) and `project-cli-{win32-x64,darwin-arm64,darwin-x64}` (the Go launcher), `copy-binaries.sh` fills them. The pipeline is `.github/workflows/publish.yml`.

| File | Origin |
|---|---|
| Go launcher sources, `build.sh` | not copied: `@wadeck-app/singleton-daemon-kit` (devDependency), `ci/scripts/build-launcher.mjs` calls its `build.sh` with `ci/launcher-project.config.json` |
| `ci/templates/bin-launcher.js.tmpl`, `ci/scripts/generate-platform-packages.sh` | copied unchanged from the canonical `ci-templates` repo (`templates/`, `scripts/`, last changed in commit 094d29e) |
| `ci/scripts/build-launcher.mjs`, `copy-binaries.sh` | written here from the equivalent scripts of `task-cli` (names changed, no app-module) |

The canonical launcher template has no `windowsHide` and no `--cli-background` / `--cli-foreground` handling, which the task and queue copies added; the project CLI needs neither (no daemon, nothing spawns it in the background). If one day it does, change the template in `ci-templates` and copy it again.

## Development

`npm run build` then `npm test` from the repo root. Unit tests call `run(argv, io, env, cwd)` in-process; the end-to-end suite spawns the built `dist/main.js` with `XDG_CONFIG_HOME`, `HOME` and `USERPROFILE` redirected to temp dirs (a missing build fails it). `src/packaging.test.ts` builds the bundles with a fake version and checks the generated packages (names, `files`, versions, `npm pack` content). `npm run build-launcher` needs `go` and `bash`.
