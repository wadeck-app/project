# Current state: task / flow / queue, for a "project" concept

Read-only analysis, 2026-10-23. Facts only; "unknown" = not verified. Paths relative to C:\Workspace_Tooling.

## 0. Repos found

| CLI | Source repo | Installed as | Evidence |
|---|---|---|---|
| task | `task/` (task-core, task-service, task-cli, app-module-task) | `/c/App/nodejs/task` -> `@wadeck-app/task-cli` | task/CLAUDE.md "Packages" |
| flow | `agent-fleet/` (flow-cli, flow-core, flow-engine, extension-points, app-module-flow, worker, ...) | `/c/App/nodejs/flow` -> `@wadeck-app/flow-cli` 2026.10.22-674-f1835e7b | version suffix = HEAD of agent-fleet (f1835e7b, branch integration) |
| queue | `queue/` (queue-core, queue-cli, queue-relay-client, plugin-github, app-module-queue) | `/c/App/nodejs/queue` -> `@wadeck-app/queue-cli` | queue/CLAUDE.md |
| sample project | `_test-flow/` | n/a | NOT the flow repo: a demo project holding `.task/ .queue/ .flow/ flows/` (README.md) |
| shared libs | `shared-cli/packages/shared-cli`, `singleton-daemon-kit/`, `app-core/packages/app-core-sdk` | npm `@wadeck-app/*` | package.json deps |

Other `agent-fleet_*` dirs are old checkouts/branches (not analysed). `orchestrator/` is unrelated to flow-cli.

## 1. Where state/config lives

### task
| What | Location | Format | Resolved by |
|---|---|---|---|
| Project marker + data | `<project>/.task/` (`config.yml`, `tasks/`, `task-index.json`) | YAML / per-task files / JSON | EXACT dir only, NO walk-up: `isInitialized` = `existsSync(dir/.task)` (task-core/src/TaskConfigLoader.ts:106-109; used task-cli/src/TaskIndex.ts:65) |
| Project dir choice | cwd; overridden by `--project-dir`, then env `TASK_PROJECT_DIR`, then env `PROJECT_DIR` | n/a | TaskIndex.ts:28-30; cli/args.ts:3-5,37 |
| Project config (statuses, types, fields, defaults.priority, hooks) | `<project>/.task/config.yml` | YAML | TaskConfigLoader.ts:116 |
| Global config (defaults.priority, hooks) | `$TASK_CONFIG` or `~/.task/config.yml`; `--config <dir>` overrides | YAML | TaskConfigLoader.ts:100-104; help.ts:62,83. `~/.task` does not exist on this machine |
| Projects registry | `<configDir>/projects.json`: JSON array of absolute project dirs; lock + tmp/rename writes | JSON | task-service/src/projectsRegistry.ts:16-18,49-79,82-95 |
| CLI config dir (registry, logs/, update files) | `$XDG_CONFIG_HOME/task` else `~/.config/task` (no `TASK_CONFIG_DIR` override) | n/a | task-service/src/configDir.ts:10-13 |
| Invocation log | `<configDir>/logs/YYYY-MM-DD.ndjson` | ndjson | TaskIndex.ts:34; configDir.ts:16 |

Two global dirs coexist: `~/.task` (or `$TASK_CONFIG`) for config.yml, `~/.config/task` for registry/logs/update. Here `~/.config/task/projects.json` is `[]` although `_test-flow/.task` exists (cause unknown).

### flow (agent-fleet/packages/flow-cli)
| What | Location | Format | Resolved by |
|---|---|---|---|
| Project root | nearest ancestor with `.flow/config.yml` (wins outright); else nearest ancestor with `.git` (file or dir); else ERROR (no cwd fallback); legacy layouts give a migration error | n/a | config/DefaultProjectResolver.ts:6,61-105; contract extension-points/src/project-resolution/v1.ts |
| Project files | `<root>/.flow/config.yml` (plugins + hooks), `.flow/flows.yml`, `.flow/flows-custom.yml`, `.flow/workspaces/`, `.flow/.tmp/` | YAML | RunCommand.ts:160; Daemon.ts:116,136 |
| Global dir | `<XDG_CONFIG_HOME or ~/.config>/flow` (`config.yml`, `config.port`, `health_token`, `executions/`, `logs/`, `worker-sources.json`, `approvals/`) | YAML/JSON | config/FlowConfigDir.ts:130-132; flow-core FlowConfigLayout.ts:7 |
| Global config override | env `FLOW_CONFIG` (file must exist, else error) | YAML | config/ConfigLoader.ts:80-96 |
| Execution records | GLOBAL `~/.config/flow/executions/<id>.json` (326 here, 326 carry `projectRoot`, e.g. `C:\\Workspace_Tooling\\_test-flow`) | JSON | storage/ExecutionStore.ts:60-76; flow-core ExecutionState.ts:55-61 |

Daemon-wide settings (queue.concurrency, logs, worker, limits, workspace, opencode) are global-only (FlowConfig.ts:117-119 comment). `_test-flow/.flow/config.yml:7-10` says a `queue:` key in a project file is silently ignored (comment only, not verified in code).

### queue
| What | Location | Format | Resolved by |
|---|---|---|---|
| Config/data dir | `$QUEUE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/queue`, else `~/.config/queue` (`wal.ndjson`, `dlq.ndjson`, `history/`, `logs/`, `subscribers.yml`, `relay.yml`, `config.yml`, `config.port`, `health_token`, `_secrets_/`) | ndjson/YAML | queue-core/src/configDir.ts:10-17; QueueIndex.ts:171-173 |
| Global subscribers | `<configDir>/subscribers.yml` | YAML (zod) | queue-core/src/ConfigLoader.ts:191,227 |
| Project subscribers | `<dir>/.queue/subscribers.yml`, found by WALK-UP from the event cwd, max 20 levels, nearest wins | YAML | ConfigLoader.ts:246-260 |
| Project NAME | basename of nearest ancestor containing a `.queue` dir (any content) | string | ConfigLoader.ts:56-69 (marker differs from :246, which needs `subscribers.yml`) |
| `--scope project` writes | `process.cwd()/.queue/subscribers.yml` (NO walk-up, creates `.queue`) | YAML | QueueIndex.ts:695-697,1332 |

## 2. Scoped by cwd/repo vs global; project/id notions

| CLI | Per-project | Global | Existing identity notion |
|---|---|---|---|
| task | tasks, statuses, types, fields, hooks (`.task/`) | registry, logs, update, global hooks/default priority | project = absolute dir; name = `basename` (task-service/src/openContext.ts:40-42); task id = 8-char base36, unique only within a project (TaskStore.ts:9-13); registry compare case-insensitive on win32 (projectsRegistry.ts:29,34) |
| flow | flow files, `.flow/config.yml`, `.flow/workspaces` | single daemon, executions, logs, worker sources, daemon settings | `projectRoot` absolute path stored per execution (CommandHandler.ts:483-498); workers declare `attachedProjects` (WorkerLaunch.ts:192-194; `flow worker --project <path>` repeatable; env `FLOW_WORKER_PROJECTS`); StepRouter routes a step only to a worker attached to its projectRoot (StepRouter.ts:56-59). No registry: projects discovered from runs. "List active projects" is mentioned (ExecutionStore.ts:65, D#10); a listing command: not found |
| queue | subscribers selected by the cwd sent with each event | one WAL, one DLQ, one history, one daemon, one relay | `meta.cwd` + `meta.projectName` (basename) (QueueService.ts:78-92); history entry has `project` and `cwd` (HistoryLog.ts:12-17). `HistoryFilter` = event, subscriberId, status, sinceMs only (HistoryReader.ts:49-54) |

Nesting today: task = none (exact dir); flow = nearest `.flow/config.yml`, `.git` fallback; queue = nearest `.queue/subscribers.yml`, no merge between nested levels (global + nearest are concatenated, section 6). In a subdirectory `task` fails with "project not initialized" (TaskIndex.ts:65-67) while flow and queue resolve a parent.

## 3. Daemon / server / relay

| CLI | Process | Transport | Keyed by |
|---|---|---|---|
| task | none (one-shot); app-module registered with app-core | app-core HTTP `127.0.0.1:4850` default (`APP_CORE_PORT`; app-core-sdk register.ts:74-106); module routes take `?project=<dir>` | project dir path |
| flow | per-user machine-wide singleton daemon serving every project (Daemon.ts:101-104,230); WebSocket for workers (`worker.wsPort`, default HTTP port+1) | HTTP 127.0.0.1, base port 47823, tries +0..+10 (singleton-daemon-kit health-server.ts:91,222); `~/.config/flow/config.port` (here: port 47823) + `health_token`; `run` command carries `cwd` (RunCommand.ts:495-504) | execution id; projectRoot derived from `cmd.cwd` |
| queue | per-user singleton daemon (idle stop 60 s); separate relay client (WebSocket to `wss://assistant.wadeck.ch/relay-ws`, GitHub events) | HTTP 127.0.0.1, port 47910 (queue-cli/src/daemon/QueueDaemon.ts:6,47); `~/.config/queue/config.port` + `health_token`; client = kit `createDaemonClient` (QueueClient.ts); `push` sends `{event,payload,timeout,cwd}` (QueueIndex.ts:909) | event/WAL id; cwd in meta |

Kit port file `config.port` = `{sdkVersion,port,pid,startedAt}` (port-file.ts:7-18); client connects to 127.0.0.1 (client.ts:39).

## 4. Command surface relevant to targeting

| CLI | Targeting flags/env | Cross-project / global commands |
|---|---|---|
| task | `--project-dir <dir>` (parsed only AFTER the command word, args.ts:34-45; also applies to `init`, TaskIndex.ts:47-48), env `TASK_PROJECT_DIR`/`PROJECT_DIR`, `--config <dir>`, `--json` | `task projects list\|add [dir]\|remove <dir>\|move <old> <new>\|prune [--dry-run]\|summary`; `task list --all-projects [--all] [--json]` (refuses `--follow --tree --parent --project-dir`; GlobalViewCommands.ts:41-64; help.ts:21-23,54-59). `task new "..." --project-dir B` already adds to B from anywhere (B needs `.task`, no walk-up). Targeting a registered project by name: none found |
| flow | none on `run`, `show`, `history`, `resume`, `validate` (RunCommand.ts:410-446; HistoryCommand.ts:27-32 = -n, --offset, --status, --flow, --id, --json). Project = process.cwd() resolved by walk-up. Flow ref = file path (relative to cwd) or id from `<root>/.flow/flows.yml`. `flow worker --project <path>` (repeatable), `flow worker source add --cwd <path>` (WorkerCommand.ts:236-239; WorkerSourceCommand.ts:97). Env `FLOW_CONFIG`, `FLOW_WORKER_PROJECTS` | `flow history` has no project filter found; `flow start\|stop\|status`, `--pid` are daemon-wide |
| queue | none; cwd implicit (`process.cwd()` sent to daemon). `--scope global\|project` on `queue sub *`. `queue wait ci [<sha>] [--repo <owner/name>]` (waitCli.ts:19,34; repo defaults to git `origin` of cwd) | history/status/dlq global; `list-subscribers` uses cwd (QueueIndex.ts:1031). `queue replay <eventId>` reuses recorded `cwd` if it exists, else current cwd + warning (replayCwd.ts). Push into another project = `cd B && queue push ...` (what task does) |

## 5. Cross-CLI coupling

| From -> To | Mechanism | Shared identifiers | Evidence |
|---|---|---|---|
| task -> queue | spawns `node <queue.js> push <event> <json>` with `cwd = payload.taskProjectPath`; queue.js found via `where queue.cmd`/`which queue`; failure goes to stderr + task log, never fails the command | `taskProjectPath`, `taskProjectName`, `taskId` in payload; replay = `cd '<dir>' && queue push ...` | task-service/src/queueEventSink.ts:65,155; events.ts:83-95; context.ts:12-14 |
| queue -> flow | by CONFIG, not code: subscriber `command:` string (e.g. `flow run <abs file> --input taskId={{ payload.taskId }}`), `spawn(shell)` with cwd from subscriber/event/global/file default (= dir above `.queue`) | taskId by template; flow project derived from that cwd | queue-core CliTransport.ts:31-37; ConfigLoader.ts:150-155; `_test-flow/.queue/subscribers.yml` |
| flow -> task | flow step scripts call the `task` CLI (`_test-flow/flows/01_triage.yml:82,93`, `02_plan.yml:36`). No `TASK_PROJECT_DIR`/`PROJECT_DIR`/`--project-dir` set by flow-cli/flow-engine src (grep: none), so the step cwd decides the task project (step cwd rules: unknown) | taskId as flow input | flows/*.yml |
| hooks | shared `HookDispatcher` events `onFlowStart..`, `onTaskCreated`, `onStatusChange`, separate from the queue path | `taskProjectName/Path` in payload | shared-cli HookDispatcher.ts:8-17; flow-cli/HOOKS.md:22-27 |
| code imports | NONE between the three repos (task-core TaskStore.ts:9 inlines flow's id generator; task PluginsCommand.ts:15 avoids a dependency) | n/a | package.json of all three |
| queue CI wait | git of cwd + `origin` remote -> `owner/name`; events matched on `repository.full_name` | sha, repo | waitCli.ts:216-227; ciWait.ts:75-91 |

Shared identifiers today: absolute project path (task registry, flow `projectRoot`, queue `cwd`), basename as name (task, queue), task id (payloads/inputs only), sha + `owner/name` (queue wait ci only). No shared project id. Git-root detection: only flow (`existsSync` of `.git` while walking up, DefaultProjectResolver.ts:84); task/queue run `git rev-parse` only for version hash (task, flow) or CI wait (queue).

## 6. Config layering

| CLI | Order | Merge rule | Evidence |
|---|---|---|---|
| task | `defaults.priority`: built-in `medium` < global < project. statuses/types/fields: project only (default statuses `backlog,in-progress,done`). Hooks: global and project kept separate (`globalHooks`, `projectHooks`) | field-wise `??` | TaskConfigLoader.ts:118-130 |
| flow | daemon settings: built-in < `~/.config/flow/config.yml`, global-only (legacy `~/.flow-config.yaml` reported, never merged). Plugins: project sections reference global named `instances` via `use:` or inline `instance:`; options shallow-merged, section over instance; `${ENV}` interpolation; literal credentials rejected. Hooks: project file only | shallow per feature | ConfigLoader.ts:134-250; FlowConfig.ts:144-190; Daemon.ts:128-148 |
| queue | global `subscribers.yml` then nearest project file: subscribers CONCATENATED per event (both fire). cwd: subscriber > event > file-level > project root; env merged global < event < subscriber | additive | ConfigLoader.ts:196-232; toResolved :146-181 |

No CLI has a default < user < repo < local-override scheme; none merges several nested project levels.

## 7. Shared libs and where a "project resolver" could live

| Lib | Provides | Used by |
|---|---|---|
| `@wadeck-app/shared-cli` (shared-cli/packages/shared-cli/src) | `ConfigDir.get(app)` (ConfigDir.ts:8-12, plus `migrateIfNeeded`), `UpdateManager`, `HookDispatcher`, `CliLogger`, `resolveOwnBundlePath`, `ChannelConfig`, `LiveRegion`, `FollowSnapshot`, `Duration`, `SelfCheck`, meta commands. No project/registry code | task-cli, flow-cli, queue-cli |
| `@wadeck-app/singleton-daemon-kit` | daemon lifecycle, port file, HTTP client, Go launcher | task-cli (declared dep), flow-cli, flow-core, queue-cli, queue-relay-client, app-module-queue |
| `@wadeck-app/app-core-sdk` | app-module registration at app-core; no project concept (grep "project": only violations.ts) | task-cli, queue-cli, flow-cli |
| `extension-points` (agent-fleet) | `ProjectResolutionProvider` interface (v1.ts) | flow only |

Duplication: config-dir logic restated in task-service (configDir.ts) and queue-core (configDir.ts) with parity tests against shared-cli, so that app-module/reader packages need no CLI library. Registry code (list/register/lock/validate path) exists only in task-service (projectsRegistry.ts, registryLock.ts, projectPaths.ts). Project resolution is implemented three times: task (exact `.task`), flow (DefaultProjectResolver), queue (two walk-ups in ConfigLoader.ts).

Facts for the placement decision: shared-cli is the only package already depended on by all three CLIs and already owns `ConfigDir`; task-service and queue-core avoid it on purpose (parity-test pattern), so a lib they consume would have to be dependency-light or restated. flow-cli depends on shared-cli "latest" (package.json:26); whether flow-core could take it: unknown.

## 8. Gaps noticed

- A registry of projects exists in task only; flow has `projectRoot` inside execution records, queue has `cwd`/`project` in history entries.
- Queue's two project markers differ (`.queue` dir vs `.queue/subscribers.yml`); `queue sub --scope project` does not walk up while loading does.
- Project name is a basename wherever it exists: same-named folders are indistinguishable by name (task `ProjectOverview.name`, queue `projectName`).
- `flow history` and `queue history` have no project filter; `flow run` and `queue push` can only target a project via process cwd (task has `--project-dir`).
