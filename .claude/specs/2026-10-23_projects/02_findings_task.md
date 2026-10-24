# Findings: task, shared-cli, app-core docs vs. a shared "project" concept

Read-only research, 2026-10-23. Facts only; "unknown" = not verified. Scope: `task/`, `shared-cli/`, `app-core/`. Complements `01_current-state.md` (not redone).
Paths relative to `C:\Workspace_Tooling`. Abbrev: T = `task/CLAUDE.md`, ADD = `app-core/.claude/specs/2026-10-10_modular-plugin-platform/` (`_index.md` = decision log).

## 0. What exists (and what does not)

| Repo | Docs touching projects | Verdict |
|---|---|---|
| task | `CLAUDE.md` (26 KB, the only real source), `.claude/plans/2026-10-18_task-app-module.md`, spec `2026-10-11_plugin-extension-system/` (plugins, not projects), `architecture/rules.ts`, ~40 test files | Registry is fully documented in T:14,22-28,38-63. No spec/ADR for a "project" concept, scope, nesting or monorepo (grep: zero hits for nested/monorepo/sub-project/walk-up in task docs; only code hits are task-hierarchy `ancestors`) |
| shared-cli | `CLAUDE.md`, `README.md`, `.claude/{guiding-principles,out-of-scope,product-vision,threat-model}.md`, `docs/cli-best-practices.md` | Zero mention of project/registry/scope-of-config. Only config-dir rules |
| app-core | `CLAUDE.md`, `README.md`, spec ADD (`_index.md` 99 decisions, `out-of-scope.md`, `future-iterations.md`, `guiding-principles.md`), plans, `module-authoring.md` | No project concept at all. Only `ctx.dataDir` and per-module config dir |
| task CHANGELOG / roadmap / ADR / `docs/` / `kb/` | none exist in task, shared-cli, app-core (checked with find) | n/a |

No file in these three repos records a decision about nesting, hierarchy, monorepo, sub-projects, a project id, name-collision policy, `.task` walk-up, local-vs-global config layering beyond `defaults.priority`, or a `project` CLI. Git log of task (`git log --grep=project`) shows only registry/app-module commits (225202c, 6c912a9, ad95014, 7ac42df, e27c275, 4a0c53a, ceb30db).

## 1. Decisions already made that constrain the design

There are no numbered decisions in task (the task plan has an unnumbered "Decisions" list). Numbered decisions exist only in app-core ADD and the task plugin spec.

| Id / source | Decision (verbatim or tight paraphrase) | Constraint on a project design |
|---|---|---|
| task plan `2026-10-18_task-app-module.md:10` | "app-module has no cwd. Backend reads a list of project dirs from `<configDir>/projects.json`; routes take `?project=<dir>`. Registered by `task init`." | Registry format = JSON array of absolute dirs, in task's config dir; any registry owner change needs a migration of this file |
| T:22 | "The module has no cwd: projects come from `<config dir>/projects.json` (written by `task init` and `task projects add`), routes take `?project=<dir>`" | Same; the app-module reads the registry itself |
| T:12 | "`task-core` <- `task-service` <- `task-cli` and `app-module-task`. ... `task-service` knows no CLI, HTTP or app-core library" ; arch test enforces | Registry logic lives in task-service (T:14) and must stay free of shared-cli (rules.ts:42 `SHARED_CLI` forbidden in task-service and app-module-task) |
| T:14 | Registry API owned by task-service: `listRegisteredProjects`, `unregisterProject`, `inspectRegisteredProjects`, `pruneMissingProjects`, `registerInitializedProject`, `initProject`, `addProject`, `relocateProject`, `removeRegisteredProject`; cross-project reads `summarizeProjects` / `listTasksAcrossProjects` | A generalized registry would have to keep these call sites or replace them |
| `task-service/src/configDir.ts:6-8` (code comment) | Config dir "restated here so that task-service and the app-module need no CLI library"; parity test `task-cli/src/configDirParity.test.ts:19-30` keeps it equal to `ConfigDir.get('task')`; "honours no TASK_CONFIG_DIR override" | Restate+parity-test is the accepted pattern to avoid shared-cli dependency |
| T:24 | Registry edits touch the registry ONLY: "a project's `.task` and directory are never deleted or moved"; `validateProjectPath` refuses non-absolute, `.`/`..`, NUL, surrounding whitespace, `\x`, `C:x`; normalizes with `path.resolve` | Registry never owns project data; path rules are fixed |
| T:23, tests `ProjectsCommand.test.ts:102-150` | `projects add` needs a `.task` in the dir (else error with `task init` hint); idempotent; `remove` is case-insensitive on Windows; unknown dir is an error; `prune` keeps dirs that cannot be stat'ed | Registration requires an initialized project; a project is a directory (`projectsRegistry.test.ts:183` "a path that is a file is missing") |
| `projectsRegistry.ts:25-26,29,34` + tests `:60`, `:137` | Identity = normalized absolute path; compare case-insensitive on win32 only; registration order kept (`:66`) | Project identity today is the path; no id |
| T:35 + `projectRef.ts:15-21` + `projectRef.test.ts:25` | App-module page key `:project` = slug `<dir name>~<6 hex sha1 of normalized dir>`; "tells two directories with the same name apart"; `findProjectByRef` accepts slug OR absolute dir | Existing precedent for name-collision handling (slug, 6 hex), only in the UI layer |
| T:75 | "two projects with the same directory name read `alpha`/`alpha` in lists and selects (slug differs, label does not)" - listed as Known | Name collision known and unresolved in labels |
| T:14, T:54 | Cross-project read semantics: unreadable projects reported, others still listed; `NoReadableProjectsError` / exit 1 only when none readable; nothing registered = exit 0 with `task init` hint; corrupt registry throws (never empty list: `projectsOverview.test.ts:178`, `projects.test.ts:95`) | Failure policy for any `--all-projects`-like operation |
| T:54 | `task list --all-projects` "Fails with an actionable error when combined with `--follow`/`-f`, `--tree`, `--parent` or `--project-dir`"; test `GlobalViewCommands.test.ts:206` "one project and all projects contradict" | `--project-dir` and all-projects are mutually exclusive today |
| T:93 | queue push runs with `cwd = payload.taskProjectPath`; "`queue push` has no cwd option (verified ... it sends `process.cwd()`), and queue finds `<project>/.queue/subscribers.yml` by walking up from it. A payload without a non-empty string `taskProjectPath` is undelivered with an explicit reason, never pushed from the current cwd" | task->queue contract: cwd = project dir; payload keys `taskProjectName`, `taskProjectPath` on all events (T:84) |
| T:94 | Queue failure never fails the command | Integration is best-effort |
| T:95 | Replay text = `cd '<taskProjectPath>' && queue push ...` (POSIX quotes) | Depends on cwd-as-project |
| T:16-20,21 | app-core registration: no daemon, `task cli register`; staged manifest in `<config dir>/app-module/<version>/`; `appModuleStaging.ts` imports only fs/path; updater bundle < 500 KB and free of the task runtime | Registry code must not be pulled into the updater bundle |
| T:64,73 | Module persisted state only in `ctx.dataDir/last-project.json` (last created-in project); no `$persist` | UI selection state is module-local |
| T:36 | Old page addresses with `?project=` are dropped ("Not kept") | UI contract already broke once; not a constraint for CLI |
| T:63 | Zero registered projects: `noProjectsText` (next step `task init` / `task projects add <dir>`) | UX wording to update on change |
| ADD `_index.md:33` Decision #4, P-3 (`guiding-principles.md:92`) | app-core "agnostic about what a loaded module's backend code actually does" | app-core must not learn a project concept |
| ADD `_index.md:32` Decision #3, P-1/P-2 (`guiding-principles.md:84-90`) | Daemons never embedded in app-core; module code runs in app-core's process; module backend reading files is the module's business | app-module reads the registry file in-process; a registry owner must be file-readable without a daemon |
| ADD `_index.md:370`, `module-authoring.md:302` Decision #84/87 | `ctx.dataDir` = `<app-core config dir>/data/<id>/`, never deleted by app-core | Place for module-local state, not for shared registry |
| ADD `_index.md:116,129` P-6 / Decision #21 | A module lives in its own daemon's repo | A `project` CLI would need its own module/repo if it wants a UI; unknown whether wanted |
| ADD `_index.md:162-163` Decisions #32/#33 + P-7 | Slot contracts owned by the PROVIDING module, versioned with its package; contributor takes a real dependency on the provider | Cross-module UI sharing = `requires`/`expose` between modules, not through app-core |
| ADD `_index.md:368,372` Decisions #82/#86 | `requires` (id -> semver range) and `expose` between modules | The way a task module could consume a `project` module |
| task plugin spec `_index.md` Decision #3 (line 20 of that file) | "Each application implements its own extension-point/registry mechanism independently in V1 (Option B). No shared engine package yet. Extraction ... deferred until at least two apps have a real, working implementation"; user chose "reluctantly"; risk "recorded ... not swept aside" | Precedent for the per-CLI vs shared-lib trade-off; open question #2 (what triggers extraction) is still Open |
| shared-cli `.claude/guiding-principles.md:3` | "no runtime dependencies - `package.json` `dependencies` must stay empty" (verified: `packages/shared-cli/package.json` has only devDependencies) | A project/registry lib in shared-cli cannot add `yaml`, `zod` or a lock lib as dependency |
| shared-cli `.claude/guiding-principles.md:4` | Canonical config dir `~/.config/<appName>` on ALL platforms | A shared registry dir would be `ConfigDir.get('<something>')` |
| shared-cli `.claude/product-vision.md:4` | "Scope stays narrow: only generic daemon/CLI lifecycle concerns that every Wadeck CLI needs; no app-specific logic" | A generic project registry arguably fits "every CLI needs"; unknown whether the owner agrees |
| shared-cli `docs/cli-best-practices.md:64` | "Two directories for one tool is a debugging anti-pattern (see P-1 in guiding-principles)" | task already violates it (see section 4) |
| `docs/cli-best-practices.md:46` | "`queue-cli` stays in family A (decision of its owner, 2026-10-18)" | Distribution family of a new `project` CLI must pick A or B (section 1.1 table) |

## 2. Explicitly rejected / out of scope / deferred

| Item | Status | Evidence |
|---|---|---|
| Walk-up resolution of `.task` | Not stated anywhere as a decision. Behavior only: `task` fails with "project not initialized" in a subdir. No doc says rejected or wanted | `TaskIndex.test.ts:59`; T has no statement. Treat as UNDECIDED |
| `task list --all-projects --follow` | Deferred, "needs decisions first: cost (every project re-read every 500 ms), and what to print when a project becomes (un)readable or all fail mid-follow" | T:56 |
| Combining `--all-projects` with `--tree`, `--parent`, `--project-dir`, `--follow` | Refused with error | T:54; `GlobalViewCommands.test.ts:191,206` |
| Global Delete | Rejected by design: "Delete: never global ... `allProjects` is ignored by the delete routes" | T:48 |
| Deleting/moving project data on registry remove/move | Rejected: registry only | T:24; `relocateProject.test.ts:146` "NEVER deletes the .task data nor the directory" |
| UI add creating deep directory trees | Rejected: only one level, only mode `init` + `createDirectory: true`; typo must not leave a stray tree | T:25; `addProject.test.ts:110-124` |
| Back links ("All projects", "All tasks") | Removed; breadcrumb carries context | T:50 |
| Redirects/second route set for old addresses | Not kept | T:36 |
| `TASK_CONFIG_DIR` override for the task registry dir | Not honoured, on purpose (parity with shared-cli) | `configDir.ts:6-8`; `configDirParity.test.ts:30` |
| Events for `set-type`, labels, `set-meta`, parent changes, `delete` | Open decision of "the owner", nothing implemented | T:97-102 |
| `--cwd` option in `queue push` (queue repo) / replay for cmd.exe, PowerShell | Open decision of the owner | T:102 |
| Write routes beyond status/labels/meta/links/parent in first iteration; task-specific React components | Out of scope (task plan) | plan:20-23 |
| Plugin distribution via npm, dynamic plugin loading | Out of scope | task spec `out-of-scope.md` |
| app-core: sandboxing/isolation between modules (Decision #6), app-core mediating module-daemon interaction (#4), npm-sourced module registration (#11), daemons inside app-core (#3), iframe embedding (rejected, #69), middleware hooks (#35) | Out of scope / deferred | ADD `out-of-scope.md:8-34`, `future-iterations.md` |
| shared-cli out of scope | Arg parsing/CLI framework; "Config file format parsing ... general YAML/JSON config parsing is caller responsibility"; "Application business logic"; "Daemon lifecycle management - use singleton-daemon-kit"; startup registration | `shared-cli/.claude/out-of-scope.md:3-10` |
| Sharing an extension engine across apps (task spec) | Deferred until >= 2 apps implement it | task spec Decision #3 |

Nothing in the three repos records the user rejecting a `project` CLI, a global registry, nesting, or per-CLI registries. "Rejected" items above are all unrelated to that question except the dependency/out-of-scope lines for shared-cli.

## 3. Planned but unimplemented, related to projects

| Item | State | Evidence |
|---|---|---|
| `task list --all-projects --follow` | Not implemented; feasible with `diffSnapshot` keyed by path+id; needs decisions | T:56 |
| Targeting a registered project by name/slug from the CLI | Not implemented and not planned in docs. App-module has slug resolution (`findProjectByRef`), CLI only takes a directory | T:35, `args.ts:34-45` |
| Any cross-CLI project registry / `project` CLI / project id | No doc, no plan. unknown whether an owner request exists outside these repos | grep found none |
| Walk-up for task / sub-project scopes | No doc, no plan | n/a |
| Queue open decisions (events, `--cwd`) | Open, nothing implemented | T:97-102 |
| Mid-iteration items in T "Known": add form keeps values after success; old success badges stay until reload | Known issues | T:38 |
| Unverified in T:93 | "a project directory that no longer exists makes the spawn fail with a generic ENOENT message" | T:93 |
| Narrow-screen / navbar fixes | app-core fixes pending | T:74 |
| task spec open question #2 (trigger for shared extraction) | Open | task spec `_index.md` Open Questions |
| app-core backlog (no project item): npm-sourced registration, module-owned React (superseded by #69), module packaging (delivered later), `ExtensionSlot` upstream | Deferred/delivered | `future-iterations.md` |

## 4. Contradictions and gaps (docs vs code, docs vs docs)

| # | Gap | Evidence |
|---|---|---|
| 1 | Two global dirs for task: help says `--config <dir>` "Global config directory (default: ~/.task)" and env `TASK_CONFIG`; registry, logs, update files use `ConfigDir.get('task')` = `~/.config/task`, never `--config`. So `--config`/`TASK_CONFIG` moves `config.yml` but NOT `projects.json`. Not documented in T; contradicts shared-cli best-practice "Two directories for one tool is a debugging anti-pattern" | `help.ts:62,83`; `TaskIndex.ts:34,62,73,76`; `ProjectsCommand.ts:98`; `cli-best-practices.md:64` |
| 2 | Plan says the registry is "Registered by `task init`"; T says `task init` AND `task projects add`; a project initialized before the registry existed is not registered until re-run (T:23 "registers projects initialized before the registry existed"; test `TaskIndex.test.ts:125`). On this machine registry is `[]` while `_test-flow/.task` exists: cause unknown (01 file) | plan:10; T:22-23 |
| 3 | `task list --all-projects` rejects the `--project-dir` FLAG only: `TaskIndex.ts:62` passes `projectDir` (flag), not `effectiveProjectDir` (which includes `TASK_PROJECT_DIR`/`PROJECT_DIR`). Behavior with the env var set: not tested here, unknown | `TaskIndex.ts:29,62` |
| 4 | T says the registry is "no project needed" for `task projects *`, test `ProjectsCommand.test.ts:352` confirms from a non-project dir. But `task init`/other commands need an exact `.task` dir (no walk-up); flow and queue walk up (01 file). Cross-CLI inconsistency, no doc explains it | `TaskIndex.test.ts:59`; 01 s2 |
| 5 | app-core ADD Decision #2 (`_index.md:26`) says "`flow`/`task` CLIs published from `agent-fleet`'s `flow-cli` package". Wrong for task: it has its own repo `task/` with task-core/task-service/task-cli/app-module-task (T:3-8) | `_index.md:18,26` vs T:3-8 |
| 6 | app-core P-6 says module package named `app-module`; amended by #53/#81/#92 to `app-module-<name>`; decision #37 says suffix style `<name>-app-module`. Docs keep both (history); reality `app-module-task` | `guiding-principles.md:105-108`; `_index.md:182` |
| 7 | shared-cli README API table omits `FollowSnapshot`, `LiveRegion`, `resolveOwnBundlePath` (README table not checked row by row for the others) that package.json exports (`./FollowSnapshot`, `./LiveRegion`, `./resolveOwnBundlePath`); `CLAUDE.md` says "config directory resolution, update management, hook dispatch, logging" only. A new shared module would need both docs updated | `shared-cli/README.md:13-28` vs `packages/shared-cli/package.json` exports |
| 8 | `cli-best-practices.md` references `@wadeck/shared-cli` and GitLab in sections 2, 3, 8 while section 1.1 says scope is `@wadeck-app` on GitHub Packages and those names are historical; also refers to "P-1 in guiding-principles" which has no P-1 in shared-cli's guiding-principles (its list is unnumbered) | `cli-best-practices.md:33,52,64,195`; `guiding-principles.md` |
| 9 | task-cli depends on `@wadeck-app/shared-cli` pinned `^2026.10.11-040-8ddd428a`, queue-cli on `latest`, flow-cli "latest" (01 file). Different pin policies across the three consumers | `task-cli/package.json:27`; `queue-cli/package.json:21` |
| 10 | Project NAME = `basename` in task (`ProjectOverview.name`) and queue; task app-module uses a different key (slug with 6-hex) for URLs; labels still collide (T:75). No cross-CLI identity doc | 01 s2; T:35,75 |
| 11 | `task-service` and `app-module-task` may not import shared-cli (rules.ts), yet task-cli does; the app-module reads the registry through task-service. So any shared registry lib consumed by task-service/app-module would need a rules.ts change or the restate+parity pattern | `rules.ts:20-24,42,64-70` |
| 12 | Queue app-module likewise depends on `queue-core`, `queue-relay-client`, `singleton-daemon-kit` but not on shared-cli (package.json) - same pattern as task | `app-module-queue/package.json:20-23` |
| 13 | task `CLAUDE.md` "Agent reference docs" table lists only `guiding-principles.md`; there is no project/registry spec file; all registry design lives inline in CLAUDE.md and the plan | T:104-108 |
| 14 | `task/.claude/lessons-recommendations.md` (open boxes) asks for a CLAUDE.md and a multi-package-layout doc; both now exist (CLAUDE.md:1-14) but boxes are unticked. Not project-related; noted only as stale | `lessons-recommendations.md` |

## 5. Dependency-direction rules (what may depend on what)

| Rule | Source | Enforced by |
|---|---|---|
| `task-core` <- `task-service` <- {`task-cli`, `app-module-task`}; adapters never import each other | T:12; `rules.ts:1-5` | `npm run test:architecture` (`architecture/architecture.test.ts`) |
| `task-core` may not import task-service, task-cli, app-module-task; no console/exit/argv in task-core and task-service | `rules.ts:61-68` | arch test |
| `task-service` may not import: task-cli, app-module-task, `@wadeck-app/shared-(cli\|updater)`, `@wadeck-app/app-core-(sdk\|cli)`, fastify/express/koa/commander/yargs/inquirer/chalk. Its only workspace dependency is `task-core` | `rules.ts:71-80`; `task-service/package.json:16` | arch test (imports, package.json deps, source patterns) |
| `app-module-task` may not import task-cli or shared-cli/shared-updater; deps: task-core, task-service (+ app-core-sdk/cli as dev) | `rules.ts:88-93`; `app-module-task/package.json:20-26` | arch test |
| `task-cli` may not import app-module-task; deps include shared-cli, shared-updater, singleton-daemon-kit, app-core-sdk, task-core, task-service | `rules.ts:83-86`; `task-cli/package.json:17-27` | arch test |
| `appModuleStaging.ts` imports only fs/path and `registerAfterUpdate.ts`; updater bundle < 500 KB and free of the task runtime | T:21 | bundle-size/arch tests (test names: unknown) |
| shared-cli: no runtime dependencies; no CLI framework; no YAML/JSON config parsing; no app logic; no daemon lifecycle (use singleton-daemon-kit); narrow scope | `shared-cli/.claude/guiding-principles.md:3`, `out-of-scope.md:3-10`, `product-vision.md:4` | convention; `.violations/config.ts` has `rules: {}` (nothing enforced) |
| shared-cli versioning: CI-only CalVer; consumers need a publish step (lesson: "design for shared-cli first rather than extract-then-migrate") | `guiding-principles.md:5`; `task/.claude/lessons-learned.md` (session 9d2035e6) | `preversion` script |
| app-core-sdk: types-only; stays a project-local dependency; `no-internal-dependencies` rule; main entry free of `node:` imports (only `/register` subpath is node-only) | ADD `app-core-sdk.md` Decisions #31/#41, `_index.md:202,357`; `app-core-sdk/README.md:15-16` | violations rule + bundle assertion |
| app-core knows nothing about module internals or daemons; daemons push registration; modules load in app-core's process; module-to-module via `requires`/`expose` with provider-owned contracts | P-1..P-7 (`guiding-principles.md`), Decisions #3,#4,#5,#32,#33,#82,#86 | server load checks, `app-core-cli check` |
| app-core-sdk must not be used for non-module concerns: no project concept (grep "project" in sdk/server docs: none relevant) | 01 file s7 | n/a |
| Parity-test pattern for restating shared-cli logic: task-service `getTaskConfigDir` vs `ConfigDir.get('task')`; queue-core same | `configDir.ts:6-8`; `configDirParity.test.ts`; 01 s7 | vitest |
| Flow side (`extension-points` `ProjectResolutionProvider`, `flow-core` deps) | not in scope of this report; see 01 file; whether flow-core may take shared-cli: unknown | n/a |

## 6. Test names that encode project behavior (reusable as acceptance criteria / regression guard)

| File | Representative tests (line) |
|---|---|
| `task-service/src/projectsRegistry.test.ts` | stores as `projects.json` in the config dir (:40); idempotent (:54); normalizes before comparing (:60); keeps registration order (:66); atomic write leaves no temp (:72); rejects relative (:77); corrupt registry fails loudly naming file and fix (:95); `isSameProjectDir` ignores case on Windows only (:137); prune treats a file as missing (:183) |
| `task-service/src/registryConcurrency.test.ts`, `registryLock.test.ts` | many processes register/unregister at once keep every entry (:77,:86); no lock/temp left (:96) |
| `task-service/src/projectPaths.test.ts` | refuses relative, NUL, `.`/`..`, whitespace (:29-50) |
| `task-service/src/registerInitializedProject.test.ts` | refuses a dir without `.task`, names `task init`, writes nothing (:38) |
| `task-service/src/relocateProject.test.ts` | replace in place (:42); works when old dir gone (:59); 400/404/409 classification (:129); remove never deletes `.task` (:146) |
| `task-service/src/projectsOverview.test.ts`, `projectsHealth.test.ts` | empty is not an error (:45,:125); unreadable reported, excluded from totals (:79); all unreadable throws `NoReadableProjectsError` (:93,:173); sorted by project name then creation (:129) |
| `task-cli/src/commands/ProjectsCommand.test.ts` | works from a dir that is not a project (:352); `move`/`remove`/`prune` cases (:152-350) |
| `task-cli/src/commands/GlobalViewCommands.test.ts` | all-projects works from a non-project dir (:77); `--project-dir` conflict (:206); plain `task list` unchanged (:214) |
| `task-cli/src/TaskIndex.test.ts` | init registers the `--project-dir` target not the cwd (:140); init twice registers once (:132); `--project-dir` precedence over `TASK_PROJECT_DIR` over `PROJECT_DIR` (:555-587); relative `--project-dir` resolved vs cwd (:292); not initialized message (:59) |
| `app-module-task/src/backend/projects.test.ts`, `projectRef.test.ts` | single registered project used when param missing (:45); 400 listing projects when several (:50); 404 unregistered without listing others (:65); slug tells same-named dirs apart (projectRef:25) |
| `task-cli/src/configDirParity.test.ts` | task-service config dir == shared-cli `ConfigDir.get('task')` (:19-30) |

## 7. Facts the design discussion can use (neutral)

- The only existing registry is task's: JSON array of absolute paths, atomic writes + lock, case-insensitive on win32, no ids, no names, no metadata, no per-entry kind (task/flow/queue). Any "scope" metadata (which CLIs configured, parent project) has no slot in this format; it would need a format change or a sibling file.
- Registry readers today: task-cli, task-service (`listRegisteredProjects`), app-module-task (in the app-core process, via task-service). Anyone replacing the file moves all three.
- Precedent for hiding a lib from a package: restate + parity test (task-service/queue-core vs shared-cli).
- shared-cli can host a zero-dependency module (JSON array + path normalization + lock are all Node built-ins in task's implementation: imports in `projectsRegistry.ts:1-2` are only `node:fs`, `node:path` plus `task-core`'s `TaskConfigLoader` - the latter is task-specific and would have to be dropped for a generic registry). Whether the lock helper (`registryLock.ts`) is dependency-free: unknown, not read.
- Name collision policy exists only as a UI slug (`<name>~<sha1[0..6]>` of the lower-cased-on-win32 resolved path).
- Nothing in these repos asserts the user's preference between: new `project` CLI + shared lib, generalizing task's `projects.json`, or per-CLI registries. The task plugin spec (Decision #3) shows the user's past choice for per-app independence "reluctantly", with extraction deferred until two real implementations exist; this is a precedent, not a decision about projects.
