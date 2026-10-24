# Findings: queue repo docs/specs/plans vs code, for the "project" concept

Read-only research, 2026-10-23. Facts only; "unknown" = not verified. Paths relative to C:\Workspace_Tooling\queue unless noted. `.claude/` abbreviated `.c/`. Builds on 01_current-state.md (not redone).

Docs read: CLAUDE.md, README.md, docs/wait.md, .c/{guiding-principles,out-of-scope,product-vision,threat-model}.md, .c/plans/* (7), .c/specs/2026-10-11_github-webhook-dispatch/* (8), .c/kb + lessons-learned (grepped), lessons-recommendations (grepped). No CHANGELOG, no ADR dir, no roadmap file. Also read: orchestrator CLAUDE.md, .c/product-vision.md, .c/out-of-scope.md, docs/daemon-config.md:330-345, .c/plans/2026-09-05_event-queue-integration.md; singleton-daemon-kit .c/{out-of-scope,guiding-principles}.md; ci-templates grepped (nothing on project/queue/cwd).

## 0. Headline

- No doc in queue (or orchestrator/kit/ci-templates) defines a "project" concept, a registry, nested scopes, or cross-project events. Only project notions: `meta.cwd`, `meta.projectName` (basename), the `.queue/` marker. Planned-but-unimplemented project items: only the open question D4 (relay events vs project subscribers).
- No trust/approval gate for project `subscribers.yml` exists in code or docs. A cloned repo holding `.queue/subscribers.yml` runs shell commands for any event pushed with a cwd under it.
- The threat model does not mention the cloned-repo case; its only stance is "file system is the trust boundary" (threat-model.md:24-26).

## 1. Decisions already made that constrain the design

| # | Decision | Evidence |
|---|---|---|
| 1 | Config merge is ADDITIVE: global first, then project; both fire. "Never document or implement 'project overrides global'". Only the nearest project file is loaded (no merge between nested levels). | .c/guiding-principles.md:15-17; ConfigLoader.ts:194-232, :246-260 |
| 2 | `QUEUE_CONFIG_DIR` is the ONLY supported config-location override; "do not add other config location mechanisms". A registry file would have to live in that dir or break this rule. | .c/guiding-principles.md:27-29 |
| 3 | Project selection = the `cwd` sent with each push (`PushRequest.cwd` required; omitting gives HTTP 500). One global daemon, one WAL, one DLQ, one history. | queue-core/src/daemon/QueueCommands.ts:7; .c/plans/2026-10-23_queue-sdk.md:32; QueueService.ts:78-92 |
| 4 | WAL entries carry `meta.cwd`; retry and DLQ replay re-resolve subscribers from `entry.meta.cwd` (current file content, not a snapshot). | QueueService.ts:184-187, :268; types.ts:1-4 |
| 5 | History trigger stores `project` (basename) + `cwd` + payload; `queue replay` reuses recorded cwd, else current cwd with a warning; dashboard replay errors when cwd is missing. | HistoryLog.test.ts:91; replayCwd.ts:12-30; app-module-queue/src/backend/replay.ts:24-42 |
| 6 | `before*` events synchronous/abortable, `on*` async WAL-tracked. Never invert. | .c/guiding-principles.md:3-5 |
| 7 | Project name = basename of nearest ancestor containing a `.queue` dir (dir existence; 20 levels). Documented that way. | .c/product-vision.md "Config model"; ConfigLoader.ts:56-69 |
| 8 | Relay events are pushed with `cwd: configDir`, so only GLOBAL subscribers match relay events. Raised as design question D4; no recorded answer. | queue-relay-client/src/push.ts:132; .c/plans/2026-10-12_review-fixes.md:51,92 |
| 9 | `queue wait ci`: repo defaults to git `origin` of cwd; `--repo` overrides; mismatch with origin skips push check and workflow inference (not an error). Relay does not replay missed events. | waitCli.ts:34,86-87,225-229; docs/wait.md:13,24-28; .c/guiding-principles.md:46 |
| 10 | Relay is source-agnostic, knows nothing about queue/projects; queue wraps the envelope at the plugin boundary. Subscriptions are per-connection; no per-consumer isolation. | specs/2026-10-11.../_index.md (decisions 3, 5); routing.md |
| 11 | Dashboard module never edits `subscribers.yml`, never starts/stops daemons; revisit only with auth/CSRF from app-core. A registry write route is the same class of risk (changes what runs). | .c/threat-model.md:52-56 |
| 12 | `app-module-queue` reads queue files via `queue-core` directly; depends on `queue-core`, never `queue-cli`. | CLAUDE.md:5 |
| 13 | Defaults 5 retries / exponential / 30 s; changing defaults is breaking. | .c/guiding-principles.md:31-33 |
| 14 | queue-sdk (draft v2, nothing implemented): publisher takes `cwd` (default process.cwd()) that "selects the project's .queue/subscribers.yml and the project name"; payload always over HTTP, never a shell; protocol changes additive. | .c/plans/2026-10-23_queue-sdk.md:3,22,23-24,61 |

## 2. Rejected / out of scope / deferred

| Item | Status | Evidence |
|---|---|---|
| Subscriber authentication/authorization (who can register/receive) | Out of scope | .c/out-of-scope.md:17-19 |
| Message broker, cross-machine routing (carve-out: relay client = local consumer) | Out of scope | .c/out-of-scope.md:3-7 |
| Event ordering, dedup, schema validation | Out of scope | .c/out-of-scope.md:9-23 |
| Own GUI; dashboard editing subscribers or starting/stopping daemon | Out of scope | .c/out-of-scope.md:25-27 |
| Own service management (launchd/systemd) | Out of scope | .c/out-of-scope.md:29-31 |
| Persistent store beyond WAL/DLQ (logs/ and history/ exempt as observability) | Out of scope | .c/out-of-scope.md:33-37 |
| HTTP subscriber HMAC/mTLS | Out of scope | .c/out-of-scope.md:39-41 |
| "Project overrides global" semantics | Rejected | .c/guiding-principles.md:17 |
| Config-location mechanisms other than QUEUE_CONFIG_DIR | Rejected | .c/guiding-principles.md:27-29 |
| Per-consumer replay cursor on relay; deliveryId dedupe, ordering, heartbeat | Rejected / deferred | specs/..._index.md decision 4; review-fixes.md:53 |
| Relay transport alternatives (smee.io, API polling, TLS-layer mTLS) | Rejected | specs/..._index.md decision 1 |
| Mutating dashboard routes (sub add/edit/remove, daemon start/stop) | Rejected until app-core auth/CSRF | .c/threat-model.md:52-56 |
| queue-sdk: starting daemon without the CLI, reading events, idempotency key, local spool for lost events | Out of scope (draft) | .c/plans/2026-10-23_queue-sdk.md:186,190 |
| Relay "past events" query language beyond basic filters | Deferred | .c/plans/2026-10-11_github-webhook-dispatch.md "Explicitly out of scope" |
| User-explicit rejection specific to a "project" feature | none found in files (chat history: unknown) | n/a |

## 3. Planned but unimplemented, related to projects

| Item | State | Evidence |
|---|---|---|
| D4: should relay events reach project-level subscribers? | Open; code still `cwd: configDir` | review-fixes.md:92,51; push.ts:132 |
| D6: which cwd for dashboard replay / `/subscribers` | Replay later fixed (recorded cwd); `/subscribers` default still app-core `process.cwd()` | review-fixes.md:94,75; backend/index.ts:231 |
| App-core auth in front of backend routes (`/subscribers?cwd=`, `/push` accept arbitrary paths) | Listed "still unverified" | review-fixes.md:99; backend/index.ts:226-275 |
| queue-sdk (cwd-aware publisher, protocol versioning) | Draft, nothing implemented | plans/2026-10-23_queue-sdk.md:3,181 |
| Relay-side list of filters per connection (poc-node) | Accepted by owner, not landed | review-fixes.md "Final status", "Open" |
| Documenting `QUEUE_PUSH_CWD` | Recommendation only; variable not in code (see 4.3) | lessons-recommendations.md:25 |
| Project filter on `queue history` | No doc plans it; HistoryFilter = event/subscriber/status/since | 01_current-state.md:58 |
| product-vision "known gaps" table | Stale (2026-08), not project-related | .c/product-vision.md "Known gaps" |

## 4. Contradictions / gaps, docs vs code

| # | Doc says | Code/other says | Evidence |
|---|---|---|---|
| 1 | `queue --help`: `--scope project` = ".queue/subscribers.yml in cwd" (line 92) and, for loading, "walks up from cwd" (line 112) | Write path is exactly `cwd/.queue/subscribers.yml` (creates `.queue`), no walk-up; loading walks up. `sub list --scope project` reads the cwd file only; `sub list` without scope asks the daemon (walk-up) | QueueIndex.ts:91-92,112,694-697,1273,1331-1332 |
| 2 | Project name from "nearest `.queue` marker directory" | Name needs only the `.queue` dir; subscriber resolution needs `.queue/subscribers.yml`. A `.queue` dir without the file yields a project name but no project subscribers, and the config walk-up continues to a parent file | ConfigLoader.ts:59 vs :249 |
| 3 | lessons-learned: "`QUEUE_PUSH_CWD` env var determines which project's subscribers.yml the daemon loads; daemon context is sticky" | `QUEUE_PUSH_CWD` appears nowhere in source; project is chosen per push by `req.cwd`. Lesson wrong or refers to removed code | grep packages/ and src/: only .c/lessons-learned.md:1094, lessons-recommendations.md:25 |
| 4 | threat-model: "TODO verify how CliTransport executes commands"; "Risk: unknown until CliTransport.ts is audited" | Code: `spawn(cmd, [], {shell: true})`, `{{ payload.x }}` interpolated raw into the command string (no quoting). Any pusher's payload (incl. relay PR text) reaches a shell | threat-model.md:31-32 vs CliTransport.ts:17-23,36 |
| 5 | Walk-up "up to 20 levels" documented | No test for walk-up, the 20 limit, nearest-wins, or `resolveProjectName` (grep of tests: none). ConfigLoader.test.ts has cwd/env/merge/validation only | ConfigLoader.test.ts:21,290 |
| 6 | `--scope` documented in help | No test mentions `scope` in queue-cli tests (grep: none) | queue-cli/src/cli/*.test.ts |
| 7 | orchestrator: events use the job's cwd if absolute, else the orchestrator config dir; "queue walks up from it" | Events without job cwd get global subscribers only | orchestrator/docs/daemon-config.md:338 |
| 8 | Project identity | basename only; filters like `meta.projectName=agent-fleet` are ambiguous for same-named dirs | PayloadFilter.test.ts:11-24 |
| 9 | Replay | If recorded cwd no longer exists CLI falls back to the CURRENT cwd, so a replay can fire another project's subscribers (stderr warning only) | replayCwd.ts:21-30 |
| 10 | README/CLAUDE.md | Neither mentions `.queue/` or project scope at all (only product-vision and --help do) | README.md:39-41; CLAUDE.md |

## 5. Dependency-direction rules

| Rule | Evidence |
|---|---|
| `queue-core` has no @wadeck-app deps (js-yaml, jsonpath-plus, zod). `queue-relay-client` -> queue-core + kit. `queue-cli` -> core, relay-client, plugin-github, shared-cli, shared-updater, kit. `app-module-queue` -> core, relay-client, plugin-github, kit; never queue-cli. | packages/*/package.json; CLAUDE.md:5 |
| Package barrels are the only public API; export only what another package consumes. | .c/guiding-principles.md:48-50 |
| queue-core config-dir logic is restated in queue-cli with a parity test (configDirParity.test.ts); queue-sdk plan repeats the pattern (own copy + parity test). | 01_current-state.md:112; queue-sdk plan:55,137 |
| Relay client source-agnostic; plugins own source mapping; relay (poc-node) stays queue-agnostic. | CLAUDE.md:5; specs _index decision 5 |
| queue-sdk: zero runtime deps, none on queue-cli (even dev), runs `queue` from PATH; queue-core devDependency only. A shared project lib would have to be dependency-free or restated. | queue-sdk plan:17,20,55 |
| Other tools reach queue only by HTTP push (kit port file + bearer token) or `queue push` CLI; no code imports between task/flow/queue/orchestrator. | orchestrator/docs/daemon-config.md:335-342; 01_current-state.md:88 |
| singleton-daemon-kit owns only `config.port`, `health_token`, `config.lock`, `config.restart`, `config.update`; "everything else is the consumer's". A registry file in the kit would break this. | singleton-daemon-kit/.claude/out-of-scope.md ("Config file schema") |
| Kit is 127.0.0.1-only plaintext HTTP, not cross-machine. | kit out-of-scope.md, guiding-principles.md |
| queue-cli depends on shared-cli "latest"; queue-core does not. | queue-cli/package.json:21 |

## 6. Existing trust / permission model

| Surface | Model | Evidence |
|---|---|---|
| Subscriber commands (global or project) | `shell: true`; cwd = subscriber/event/file/project root (absolute paths allowed anywhere); env merged; event JSON on stdin. No allowlist, prompt, per-file approval or hash pinning | CliTransport.ts:36; ConfigLoader.ts:149-155 |
| Who may register | Anyone who can write the file; "OS-level file permissions ... tool does not add its own access controls"; accepted, single-user | threat-model.md:24-26; out-of-scope.md:17-19 |
| Cloned/untrusted repo with `.queue/subscribers.yml` | Not covered by any doc. In code, any push whose cwd is under the repo loads and runs it (`cd repo && queue push`, orchestrator job cwd, task `taskProjectPath`, dashboard `POST /push {cwd}`, `queue replay`) | ConfigLoader.ts:246-260; backend/index.ts:257-275 |
| Payload into command | Raw `{{ }}` interpolation into shell string; threat-model entry still "Unknown" | CliTransport.ts:17-23; threat-model.md:31-32 |
| Daemon RPC | 127.0.0.1; bearer `health_token` (32 hex, regenerated each start, 0600 files); any local process able to read it can push with any cwd; accepted | kit guiding-principles.md; threat-model.md:34-37 |
| Relay -> daemon | Same as a local push, cwd forced to configDir (global subscribers only); token in `_secrets_/.env.local`; `wss://` required except localhost | push.ts:132; threat-model.md:63-76 |
| Dashboard | Mutating routes only run/drop what is configured; no subscriber editing; `GET /subscribers` masks header/env values; `/subscribers?cwd=` and `/push` accept arbitrary cwd; app-core auth unverified | threat-model.md:52-56; backend/index.ts:226-275; review-fixes.md:99 |
| Task / flow hooks | Not in queue docs; separate HookDispatcher. Trust model: unknown (not read here) | 01_current-state.md:87 |
| queue-sdk draft | Checks `/version` pid + config_dir before sending the token; payload never on a command line; only constant argv to `queue start` | queue-sdk plan:85-87 |

## 7. Orchestrator and cross-project coordination

- orchestrator = local job scheduler (cron/startup/manual) plus tray and dashboard; no project registry, no cross-project coordination (orchestrator/CLAUDE.md; .c/product-vision.md "Purpose"). Project relation: a job has an optional `cwd`; lifecycle events go to queue with that cwd when absolute, else the orchestrator config dir (docs/daemon-config.md:338); fallback `queue push` spawn (daemon-config.md:339-342).
- Its hand-written HTTP publisher lost events silently (no auth header, no cwd), the stated reason for queue-sdk (queue-sdk plan:11).
- Cross-project events today: only by pushing with another project's cwd (`cd B && queue push`, SDK `{cwd}`, dashboard `/push {cwd}`, task `taskProjectPath`). No doc treats "project A acts on project B" as a concept; no event field other than cwd names a target project.

## 8. Facts relevant to the registry-ownership question (no recommendation)

- queue has no registry; its guiding principle confines config location to `QUEUE_CONFIG_DIR` (4 above, item 2 in section 1).
- queue history already records `cwd` and `project` per trigger (a de-facto, unfiltered list of seen projects); WAL/DLQ entries carry `meta.cwd`.
- queue-core and the SDK plan avoid shared runtime libs on purpose; queue-cli already depends on shared-cli.
- Changing the queue project marker touches: ConfigLoader.ts:59 (name), :249 (subscribers), QueueIndex.ts:695-697 and :1332 (scope write), history `project` field, user filters on `meta.projectName`.
