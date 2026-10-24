# @wadeck-app/project-cli

The `project` command: register, inspect and resolve the projects shared by the task, flow and queue CLIs. Thin layer over `@wadeck-app/project-sdk` (registry location, rules and errors are defined there). Private; no launcher or auto-update yet.

`project --help` lists the commands. `--project` / `-p <ref>` is accepted anywhere in argv; `--json` prints machine output on stdout. Default target of a command without `<ref>`: `--project`, then `PROJECT_PROJECT`, then the project containing the cwd.

`project remove` requires an explicit `<ref>` (no `--project`, no environment variable, no cwd): a destructive command never acts on an implicit target.

SDK errors are neutral; the CLI adds a `hint:` line with its own flags (`--recursive`, `--new-main`, `--name`) built from the error data, or carried by it (`NoProjectInScopeError.hint`).

stderr always carries one line stating how the registry and project were resolved; stdout stays clean for `--json`.

| Exit code | Meaning |
|---|---|
| 0 | success |
| 1 | `ProjectError` from the SDK (`error: <message>`) |
| 2 | usage error |
| 70 | unexpected exception (stack printed) |

## Development

`npm run build` then `npm test` from the repo root. Unit tests call `run(argv, io, env, cwd)` in-process; the end-to-end suite spawns the built `dist/main.js` with `XDG_CONFIG_HOME`, `HOME` and `USERPROFILE` redirected to temp dirs (a missing build fails it).
