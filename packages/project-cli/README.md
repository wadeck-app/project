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

The notice of a successful update is shown once (`update-notice-shown.json` remembers it) but the update state is kept, so `project cli rollback` keeps working until the next update; `cli rollback` itself shows no notice and does not touch the state. Failure notices are shown once and cleared.

An update is journalled before `npm install -g` runs (`status: applying` in the update state); if the updater is killed in the middle, the next updater run repairs the install, and the next command says `An update to vX was interrupted (previous version vY). Repair it with: project cli update`.

Only a release stamped by CI (CalVer, checked by `isReleaseVersion` of `@wadeck-app/shared-cli/ReleaseVersion`) updates itself. A repo-built or locally bundled CLI never starts the background update (the version is passed to `UpdateManager.scheduleBackgroundUpdate`), and `project cli update`, `project cli rollback` and the updater itself refuse with the shared `dev build ...: refusing to update the global install of project` message: they would replace the real global install.

| Command | What it does |
|---|---|
| `project cli update` | Update now, ignoring the cache and `autoUpdate: false`; prints current, latest and status. `--check` only shows the available version, `--log` prints the update log (same file as `cli logs`) |
| `project cli version` | Installed and available version |
| `project cli rollback` | Reinstall the version before the last update |
| `project cli logs [--follow]` | Today's log: the invocations of the CLI and the updater entries |
| `project cli self-check` | Health checks (temporary registry, nothing is written to yours) |

Settings in `<registry folder>/config.yml` (the updater keeps its state, cache and logs there, next to `registry.json`): `autoUpdate: false`, `channel: <dist-tag>`, `checkInterval: <30m|4h|...>`.

An update that cannot be verified is not attempted: if `npm root -g` fails, the run fails loudly (visible in `project cli update`, and as the failure notice of the next command).

## Logs

One file per day, `<registry folder>/logs/YYYY-MM-DD.ndjson` (`~/.config/project/logs/` by default), one JSON object per line: `{ "ts", "level", "msg" }`. The updater writes to the same file in the same format. Print it with `project cli logs` (`--follow` to keep reading), or `project cli update --log`.

Each invocation writes, in order:

| Entry | `msg` |
|---|---|
| the command | `cmd: project <args>` (credentials in URLs are replaced by `***`) |
| the project found | the resolution line also printed on stderr |
| each registry change | `mutation: <what> <name> (<id>)`: names, ids and paths only, never values such as the git field, nor file contents |
| the outcome | `exit <code>`, plus the error code in parentheses when it failed (`exit 1 (PATH_OWNED)`, `USAGE`, `CLI_ERROR`, `UNEXPECTED`), at `error` level |

If the log cannot be written the command still runs and one line `warning: could not write the log (<reason>)` goes to stderr.

## Usage

`project --help` lists the commands. `--project` / `-p <ref>` is accepted anywhere in argv; `--json` prints machine output on stdout. Default target of a command without `<ref>`: `--project`, then `PROJECT_PROJECT`, then the project containing the cwd.

Labels (meta information such as `state::production` or `sandbox`; rules in the SDK README): `project add --label <label>` (repeatable), `project label add|remove <ref> <label>...` (`<ref>` is required; removing a label the project does not have is an error), `project list --label <selector>` (repeatable, AND; `key::value`, `key::*`, `*::value`, `*::*`, or a bare token as shorthand, see the SDK README; wildcards are for filters only, a stored label cannot contain `*`). Quote wildcards, or the shell expands them: bash `--label '*::sandbox' --label 'state::*'`, PowerShell `--label '*::sandbox'` (single quotes), cmd.exe `--label "*::sandbox"`. `list` has a LABELS column, `show` and `resolve` print them, and `--json` of list, show, add, resolve and the other project outputs has `labels` (always an array). Label changes are logged like other mutations (`mutation: label add shop (id) +state::production`). Labels are not inherited by child projects.

Paths are stored, logged and put in `--json` with forward slashes (the same on every platform, for scripts). What people read uses the platform's form: backslashes on Windows (`list`, `show`, `resolve`, `add`, `paths ...`, `remove`, the resolution line on stderr, error messages and the suggested `project add "C:\Users\me\work\shop"`). `project path <ref>` prints the stored form, so `cd "$(project path shop)"` works in any shell.

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
