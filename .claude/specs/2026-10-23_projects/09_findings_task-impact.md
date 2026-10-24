# Impact of spec v0.16 on task (reported by task-owner, 2026-10-24)

Source: read-only analysis by the `task-owner` session; file:line references are in the task repo and were NOT re-verified by project-owner.

## Conflicts with decisions

| Area | Task today | Conflicts with |
|---|---|---|
| Resolution | `--project-dir` / `TASK_PROJECT_DIR` / `PROJECT_DIR` (paths), exact cwd only; `isInitialized` = `<dir>/.task` exists (`TaskIndex.ts:29-30,65-67`, `TaskConfigLoader.ts:106-109`) | #3 (no marker), #11 (no paths in refs) |
| Init | `task init` creates `.task` and registers (`InitCommand.ts`, `initProject.ts:48-62`) | #14 (`project add` only) |
| Registry | `~/.config/task/projects.json`, array of absolute dirs, name = basename, no id/alias; `task projects list/add/remove/move/prune` duplicate project-cli | #2, #4 |
| App API | app module takes `?project=<abs dir>`; Projects page add/edit/remove | #2, #11 |

## Needs migration

- Data: `<project>/.task/tasks/<id>.json`, `task-index.json` (derived as `tasksDir/../task-index.json`); config `<project>/.task/config.yml`. TaskStore takes a `tasksDir`, so the move is small once a data-dir function exists.
- Two config dirs today: global `config.yml` (`--config` / `TASK_CONFIG` / `~/.task`) and `~/.config/task` (logs, registry, staging). Task's `--config` already means its global config dir.
- App page slug `<basename>~<6 hex of sha1(dir)>` is path-derived (changes on move); breadcrumb cuts a segment at 16 chars.
- Queue events carry `taskProjectName` (basename) + `taskProjectPath`; `queue push` cwd = `taskProjectPath`; no id, no origin.
- `ctx.project = {name, path}`; path must become optional (virtual projects); `last-project.json` stores a path.
- ~97 test occurrences of `.task` / `projects.json` in 21 files; TaskStore writes are plain `writeFileSync` (no temp+rename, no lock).
- Config sections: `statuses` (>= 1, <= 1 default; array deep-merge can break it), `types`, `defaults.priority`, `hooks` (fixed `globalHooks`/`projectHooks`, no consumer found), `fields` (no consumer found). Unknown keys are silently ignored today; Decision #8 makes a misplaced key an error: existing files with stray keys will start failing.

## Task-side decisions (no spec needed)

Add `taskProjectId` next to existing event fields (additive); `ctx.project = {id, name, path?}`; `last-project` stores the id; keep `summary` and `--all-projects` as task features over the SDK registry; add a "no .task" architecture rule after migration. Staging: swap resolver/flag, data-dir function, migration, schema declaration. The first two are blocked until `project-kit` has an API.

## Answers already given by decisions

| task-owner question | Answer |
|---|---|
| Is losing "tasks versioned with the code" accepted? | Yes, Decision #9 (user: tasks must not live in folders, variants make that wrong). Export path: S11, later |
| Flag/env names, `--config` clash | `--config` is only the `project` CLI's flag. SDK-using CLIs get `--project-registry-config`; task's own `--config` is not touched by any decision. Q20 (default-project env) still blocks removing `TASK_PROJECT_DIR` / `PROJECT_DIR` |
| Several paths: task list shared across worktrees? | Yes, one data set per project (Decision #9); cwd rules: Q28 |

## New backlog questions raised

Q23 SDK API shape (incl. data-dir function signature), Q24 fate of `task init` / `task projects *`, Q25 `project remove` vs data, Q26 origin format, Q27 identifiers in URLs/API and app-core registry discovery, Q28 cwd with several paths and virtual projects, Q29 write target and cross-level validation in an inheritance chain, Q30 lock/atomic coverage of tool data. Migration points (who migrates `.task`, legacy config fallback, duplicate basenames such as two `alpha`) are folded into Q7.
