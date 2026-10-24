# Findings: agent-fleet docs/specs/code vs a shared "project" concept

Read-only research, 2026-10-23. Repo: `C:\Workspace_Tooling\agent-fleet` (HEAD f1835e7b). Facts only; "unknown" = unverified.
Abbrevs: SPEC = `.claude/specs/2026-09-11_worker-availability-cli/` (all D#/Q# live in its `_index.md`; D# and Q# sequences collide, always prefix). PLAN = `.claude/plans/2026-09-12_worker-availability-cli.md`. FC = `packages/flow-cli/src`.

Search scope: specs, plans, docs/, kb/, CLAUDE.md, READMEs, HOWTO .md in flow-cli, extension-points, flow-core, tests names. No dedicated spec exists for a cross-CLI project concept, a project registry, cross-project flows, or nesting policy (grep: none).

## 1. Decisions already made that constrain the design

| Id | Decision (short) | Evidence |
|---|---|---|
| D#9 | Worker attaches to 1..n projects; default = project it was launched in; other projects explicit opt-in | SPEC/_index.md:26 |
| D#10 | Worker registry is GLOBAL in flow config, not per project; each flow run registers itself so "active projects can be listed". Daemon = per-user machine-wide singleton (`Daemon.ts:82,98-99` per spec) | SPEC/_index.md:27 |
| D#13 | Project attachment = distinct field, NOT a reserved label (labels = routing, not scoping; T-07) | SPEC/_index.md:30 |
| D#15 | Project root resolution is a strategy (S5), pluggable, with built-in default. "Repo already carries three disagreeing project-root notions" | SPEC/_index.md:32 |
| D#40 | Default S5: walk up, explicit marker wins "so a monorepo subpackage can still be scoped", then `.git` root (file or dir), fail loudly if none; no silent fallback | SPEC/_index.md:57 |
| D#47 | `.flow/` is the single project marker; supersedes D#40's `.agent-fleet/` choice; walk-up + loud failure stand | SPEC/_index.md:64 |
| D#49 | Clean break in code: legacy `.agent-fleet/` or `.flows/` without `.flow/` must fail with actionable message; folders migrated by hand | SPEC/_index.md:81 |
| D#50 | Resolver keys on the CONFIG FILE `.flow/config.yml`, never on dir existence (dir doubles as runtime workspace dir; proven by stray `.agent-fleet/workspaces/`) | SPEC/_index.md:82 |
| D#56 | `.flow/config.yml` carries both `plugins:` and `hooks:`; no format change | SPEC/_index.md:69 |
| D#58 | Global config is `~/.config/flow/config.yml` (never `~/.flow/`); principle "config dir = `~/.config/<appName>` on all platforms, never bespoke" | SPEC/_index.md:71; `.claude/guiding-principles.md:36` |
| D#22 | Acceptance default permissive; over-capture "bounded by project scoping (D#9)" | SPEC/_index.md:39 |
| D#57, D#59 | web-backend legacy `workspace-metadata.json` readers keep `.agent-fleet/`; `packages/worker` excluded (dead) | SPEC/_index.md:70,72 |
| D#3 | Pool/registry/listener live inside the flow daemon; no separate broker | SPEC/_index.md:20 |
| Q#22 | Daemon cwd leaks fixed: resolve from the client's cwd, never the daemon's | SPEC/_index.md:114; `FC/daemon/Daemon.ts:100-111` comment |
| Q#23 | Per-project config silently ignored from a subdirectory: "project identity must come from a single shared resolver, extracted out of RunCommand.ts (a CLI command file is the wrong home)" | SPEC/existing-machinery.md:97-101 |
| P-4 / CLAUDE.md | Fail fast, no fallback for unrecognized value; resolver doc: "must fail loudly ... rather than returning a fallback such as the working directory" | `FC/config/DefaultProjectResolver.ts:50-58`; `extension-points/src/project-resolution/v1.ts` |
| Dep rule | flow-core / flow-cli / app-modules share logic ONLY via flow-core (enforced by test) | section 5 |
| Meta-rule | "When a mechanism has more than one valid implementation, it is an extension point ... default assumption" (applied to S5, S7, S1) | SPEC/strategies.md ("Meta-rule") |

Project IDENTITY today in flow = absolute path string: `attachedProjects: string[]` matched with `Array.includes` (exact string compare) against `step.projectRoot` (`FC/daemon/StepRouter.ts:56-59`); `projectRoot` stored on execution record (`flow-core/src/execution/ExecutionState.ts:61`; set in `FC/daemon/CommandHandler.ts:483-498`; `ExecutionStore.ts:66-73`).

## 2. Rejected / out of scope / dropped

| Item | Status | Evidence |
|---|---|---|
| Project scope as a reserved label (`project:foo`) | Rejected (D#13) | SPEC/_index.md:30 |
| Keying resolver on `.flow/` directory | Rejected, "forced by evidence" (D#50) | SPEC/_index.md:82 |
| Keeping 3 markers (`.agent-fleet/`, `.flows/`, `.flow/`) | Rejected (D#47) | SPEC/_index.md:64 |
| `~/.flow/` global config location | Rejected (D#58) | SPEC/_index.md:71 |
| Separate broker service / multi-daemon shared fleet | Out of scope ("multi-project within ONE daemon is in scope; multi-daemon is excluded") | SPEC/out-of-scope.md:7-13 |
| Cloud pool providers | Out of scope, "future work" | SPEC/out-of-scope.md:15-18 |
| SSH launcher (daemon holds credentials to remote hosts) | Rejected (D#12, D#18) | SPEC/_index.md:29,35 |
| Worker pinning the daemon alive | Rejected (D#51) | SPEC/_index.md:65 |
| S6 retention | Dropped, not deferred (D#41) | SPEC/_index.md:58 |
| Demand-publication protocol | Rejected (D#66) | SPEC/_index.md:79 |
| Mirroring daemon LogWriter to worker | Rejected (D#31) | SPEC/_index.md:48 |
| T-09 hardening of same-user token file | Closed as not worth solving (Q#38) | SPEC/_index.md:~131 |
| Auto-migration of project-local data dirs | Intentionally not done (config-dir A-04, scrapers) | `.claude/specs/2026-08-22_15-59_cli-status-and-next/config-dir.md:42` |
| Anything explicitly about a cross-CLI project registry, `project` CLI, or nested-scope merge | NOT discussed anywhere: neither rejected nor accepted (unknown to the user's intent) | grep over specs/plans/docs: no hit |

Agent-fleet `.claude/out-of-scope.md` lists only plugin v1 isolation, CLI distribution items, orchestrator worker mgmt, policy engine: nothing on projects.

## 3. Planned but unimplemented / partially implemented (project-related)

| Item | Planned in | State in code | Evidence |
|---|---|---|---|
| "Each run registers itself so active projects can be listed" (D#10) | SPEC D#10; PLAN:109,117 ("`flow history` can name the projects with active runs") | `projectRoot` is recorded per execution (done). NO listing/filter: `HistoryCommand` has no project flag/column (grep `project` in `FC/cli/commands/HistoryCommand.ts`: no hit). flow-core `ExecutionView.projectRoot` exists but no query-by-project found. | CommandHandler.ts:483-498; ExecutionView.ts:18,60 |
| Q#20 (pool-architecture sense): "what identifies a project: absolute path, declared name, generated id?" | `pool-architecture.md:189` marked Open | Never answered in `_index.md` (its Q#20 is a different question: marker choice, Resolved). De facto = absolute path. No normalisation (case, symlink, trailing slash) found: `includes` exact compare. | StepRouter.ts:59 |
| Pluggable S5: plugin-selectable resolver | D#15, D#11 ("declare extension point, do not require external plugin for v1") | Interface + `extension-points.json` entry status `stable`, but NO config key, NO PluginLoader/PluginResolver wiring (`project-resolution` appears only in extension-points.json:82, index.ts:5, a doc comment). 6 call sites hardcode `new DefaultProjectResolver()` | RunCommand.ts:154; WorkerCommand.ts:461; ConfigLoader.ts:135; CommandHandler.ts:485; Daemon.ts:110,131,238 |
| Migration of repo's own folders to `.flow/` ("Pending" rows) | SPEC "Migration status" table | Partly done: agent-fleet root now has `.flow/` (flows.yml, flows-custom.yml, workspaces/) but NO `.flow/config.yml`; `.agent-fleet/` still holds workspace-metadata.json + workspaces/. `image-tooling`, `test-agent-browser`, `_test-tasks`: unknown | `ls -a` of repo root |
| `ProjectPluginsConfig` section for worker sources | PLAN:108 | exists per WORKERS.md; not re-verified | WORKERS.md |
| Mechanism for extra project attach (`--project`, `FLOW_WORKER_PROJECTS`) | D#9, PLAN:130 | Done (WorkerLaunch.ts:192-194 + tests) | WorkerLaunch.test.ts:98,120,132,310-322 |
| Worker attached-project registry persisted (sources) | D#10 | `worker-sources.json` global (per current-state doc); project attachment stored per source: not re-verified | 01_current-state.md:37 |

Product-vision "CLI harmonization" (T5 SDK XDG default -> T7 -> T8 -> T9) covers config dir/updater only, not projects (`.claude/product-vision.md:17`).

## 4. Contradictions / gaps between docs and code

| # | Gap | Evidence |
|---|---|---|
| 1 | `CLI_USAGE.md:23`, `.claude/skills/flow/SKILL.md:132,144`, `packages/flow-cli/HOOKS.md:42,72,94` still say `.agent-fleet/flows.yml` / `.flows/config.yml` "in the working directory". Code (D#47) uses `.flow/` and walks up; legacy now yields `LegacyProjectLayoutError`. Same for `docs/ORCHESTRATOR_FLOW_INTEGRATION.md`, `docs/WORKFLOW_SYSTEM_DESIGN.md` (`.agent-fleet/flows.yaml`) | file:lines listed |
| 2 | HOOKS.md:107-110 describes hooks merged global + project via `.task/config.yml` (task hooks), while flow hooks are read from project `.flow/config.yml` only (`Daemon.ts:128-148`, D#56). Two different "project config" notions in one doc | HOOKS.md:107-110 |
| 3 | `pool-architecture.md:183-189` still says "Open (Question #21)" and "Open (Question #20)" though `_index.md` marks Q#21 resolved (D#13) and its Q#20 is another question | pool-architecture.md:187,189 vs _index.md:112-113 |
| 4 | `extension-points.json` marks `project-resolution` `stable` v1, but the extension-point mechanism (PluginLoader) cannot load it; only the built-in is used | extension-points.json:82-86; PluginLoader.ts (ids are by `manifest.implementations[extensionPoint]`) |
| 5 | Bootstrapping circularity (inference, not documented): plugin selection lives in project `.flow/config.yml` (D#56), found BY the resolver; a plugin resolver cannot be chosen from the file it must locate. Needs global config or env selection. No doc addresses this | ConfigLoader.ts:131-140 |
| 6 | Resolver failure handling is inconsistent with "fail loudly": Daemon.ts:236-242 `catch {}` swallows the error silently for project config; CommandHandler.ts:483-492 logs "Run not attributed to a project" and continues (run stays valid, no registered worker will take its steps: StepRouter.test.ts:92); `pruneProjectWorkspaces` and `loadFlowHooks` skip with stderr line | Daemon.ts:236-242; CommandHandler.ts:483-492 |
| 7 | Daemon `ConfigLoader.resolveProjectConfigPath` uses `process.cwd()` of the process that builds the loader (`ConfigLoader.ts:135`); in a machine-wide daemon that is the daemon's launch dir, though Q#22 claims cwd leaks fixed. Per-run plugin config from the client's cwd: unknown (not verified) | ConfigLoader.ts:131-140; SPEC Q#22 |
| 8 | Nesting: spec says nearest `.flow/config.yml` wins outright and "monorepo subpackage can still be scoped" (D#40); test `prefers the nearest .flow/config.yml when nested projects exist` (DefaultProjectResolver.test.ts:52). No merge of parent+child config, no rule for which project a worker attached to the parent serves for a child step (exact string match only) | DefaultProjectResolver.ts:79-83; StepRouter.ts:59 |
| 9 | Spec/guiding principles: "No barrel files" (guiding-principles.md:79) vs the extension-points `index.ts` barrel called "the single export surface, ~27 import sites" (PLAN:37). Sanctioned exception, relevant if a shared lib re-exports | PLAN:37 |
| 10 | Spec says queue/task events carry project info via task payload (`taskProjectName/Path`, HOOKS.md:26-27); flow has none of this identity in its own events. No flow-side use of `TASK_PROJECT_DIR`: confirmed by current-state doc | 01_current-state.md:86 |
| 11 | Repo root of agent-fleet has `.flow/` without `config.yml`: resolves only via the `.git` fallback (`via: '.git'`). Not an error, but "project" = git root there | `ls .flow` |

## 5. Dependency-direction rules

| Rule | Evidence |
|---|---|
| flow-cli and app-modules (`app-module-flow`, `app-module-flow-chart`) must not reference each other; share logic ONLY through flow-core. flow-core must not reference flow-cli or app-modules. Enforced for sources, tests, manifests (package.json sections) by test; a missing package folder throws | `packages/flow-core/src/architecture/DependencyDirection.test.ts` ("The user rule: flow-cli and the app-modules share logic ONLY through flow-core"); flow-core/README.md (last line) |
| flow-core: "no printing, no `process.exit`, no environment reads. Locations are injected." "flow-core never resolves the config directory itself (hosts do, with ConfigDir.get(...))" | flow-core/README.md; flow-core/src/config/FlowConfigLayout.ts:3-4 |
| flow-core runtime deps: only `@wadeck-app/singleton-daemon-kit`, `js-yaml`. `extension-points` and `flow-engine` are devDependencies (types only) | flow-core/package.json:31-39 |
| flow-engine deps: `extension-points`, `shared-common` (file:) | flow-engine/package.json:15-17 |
| flow-cli deps: app-core-sdk, shared-cli, shared-updater, singleton-daemon-kit (all `latest`), + extension-points, flow-core, flow-engine, shared-common (`file:../`) | flow-cli/package.json:24-38 |
| `@wadeck-app/shared-cli` consumers in this repo: flow-cli, app-module-flow, app-module-flow-chart, plugin-file-approval, web-backend. NOT flow-core, NOT flow-engine, NOT extension-points | `grep shared-cli packages/*/package.json` |
| extension-points: zero runtime deps (devDeps only), "plugins depend on that package, not on internal orchestrator types"; exports `./src/index.ts` TS source + `extension-points.json` | extension-points/package.json; guiding-principles.md:22 |
| No circular deps between packages; no barrel files (except extension-points sanctioned barrel) | guiding-principles.md:8,79 |
| Internal packages use `file:../x` (not `*`) to avoid npm workspace shadowing; always `npm install` from monorepo root | kb/lessons-learned.md:6039-6060; threat-model L-02 |
| shared-cli lives in its own repo, published CalVer, "no `file:` path overrides in consumers" (D-3) | `.claude/specs/2026-08-22_15-59_cli-status-and-next/shared-cli.md:17` |
| Plan 2026-10-10: goal is task-cli with zero code dependency on anything local to agent-fleet (extractable repo) | `.claude/plans/2026-10-10_resolveOwnBundlePath-shared-cli-migration.md:5-6` |
| Repo `.violations/rules`: app-module-ascii-only, no-raw-err-in-cli, plugin-rules: none about shared-cli or project | `.violations/rules/` |
| Task/queue vs flow: no code imports across repos; coupling by CLI spawn / config strings (current-state doc section 5) | 01_current-state.md:88 |

Consequence (fact-derived): flow-core CAN technically add a dependency on a published lib (it already depends on singleton-daemon-kit), but its README forbids env reads/printing and says hosts resolve locations; shared-cli's `ConfigDir` reads env/home. flow-core importing shared-cli: no rule forbids it in `DependencyDirection`, but it would contradict the README convention. Unknown whether the user would accept it.

## 6. Can the `ProjectResolutionProvider` extension point host a shared resolver?

| Aspect | Fact |
|---|---|
| Contract | `resolve(startDir: string): ProjectResolution` where `ProjectResolution = { projectRoot: string; via: string }`; sync; throws if no root; no fallback. `via` is diagnostic only ("never branch on it") | extension-points/src/project-resolution/v1.ts |
| Fit for a shared resolver | Marker-agnostic by design ("an implementation may use any marker it likes"; json description "marker file walk-up, VCS root, etc."). A task/queue/flow-aware resolver fits the shape: returns root string + free-text reason | v1.ts; extension-points.json:82-86 |
| Missing for the new concept | No scope concept (nested scopes), no per-tool config location, no name/id, no registry/lookup by name, no list, no "which scopes between start and root" (single root returned). Needing these means a v2 of the interface (versions array supports it: `versions: [{version:1,...}]`) | v1.ts |
| Packaging | `extension-points` is `private: true`, internal `file:` package of agent-fleet, types only, not published (package.json `"private": true`, version 0.1.0). task and queue repos cannot depend on it without publishing or copying | extension-points/package.json:4; 01_current-state.md:88 |
| Loading | No wiring: only the hardcoded `DefaultProjectResolver` (6 sites) is used; PluginLoader requires `manifest.implementations[extensionPoint]` + version check against `extension-points.json` but no consumer asks for `project-resolution`. Would need: a config key, a bootstrap rule (item 5 in section 4), and replacement of 6 `new DefaultProjectResolver()` call sites by an injected instance | grep results above |
| Direction | The interface is flow's policy hook ("pluggable like S1..S9", D#15), not a cross-tool contract. Using it as the shared contract would make task/queue depend on agent-fleet's private package; a shared lib could instead implement this interface structurally (it is 2 fields + 1 method, no imports) and flow could adopt the lib's resolver as the default or as a plugin. Whether that is desirable: unknown / design decision |
| Semantics difference to reconcile | flow's default: `.flow/config.yml` > legacy error > `.git`. task: exact dir `.task`, no walk-up. queue: nearest `.queue/subscribers.yml`. A shared resolver needs a precedence rule across the three markers (not specified anywhere) | DefaultProjectResolver.ts:61-105; 01_current-state.md:60 |

## Bottom line (facts)

1. The only project concept implemented in this repo is flow's `DefaultProjectResolver` + `projectRoot` strings; specs treat "project" as a path and resolver as a flow-internal strategy.
2. Nothing in specs addresses a cross-CLI registry, nesting/merge, or `project` CLI: it is greenfield relative to these docs. D#10 (global registry of active projects) is the only precedent and is half done (data recorded, not listed).
3. Constraints to honour: loud failure (D#40/P-4), config-file marker not dir (D#50), distinct project field not labels (D#13), nearest marker wins (test at DefaultProjectResolver.test.ts:52), `~/.config/<app>` (D#58), flow-core stays env-free and does not import flow-cli/app-modules.
4. Docs to fix if flow adopts the concept: CLI_USAGE.md:23, flow SKILL.md:132,144, HOOKS.md (`.flows/`), pool-architecture.md:187-189.
