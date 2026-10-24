# Constraints and question triage -- Projects

Sources: `01`-`04` reports; key claims re-verified in code on 2026-10-23. Constraints are facts, not decisions. No existing spec in any repo covers a cross-CLI project, a project id, nesting or a `project` CLI, and none rejects them.

## Hard constraints (from code and docs)

| ID | Constraint | Evidence |
|---|---|---|
| C-1 | `task-service` / `app-module-task` may not import shared-cli, shared-updater or app-core libs; logic is restated with parity tests | task `architecture/rules.ts` |
| C-2 | `queue-core` has no @wadeck-app deps; ConfigDir restated with parity test | queue findings s5 |
| C-3 | `flow-core` runtime deps are only `singleton-daemon-kit` + `js-yaml`; README says no env reads, locations injected; a test forbids importing flow-cli | flow findings s5 |
| C-4 | `shared-cli` must keep empty `dependencies` and a narrow scope (no app logic, no daemon lifecycle, no YAML/JSON config parsing) | shared-cli out-of-scope.md |
| C-5 | `singleton-daemon-kit` owns exactly five files; a registry there breaks its scope | queue findings s5 |
| C-6 | `extension-points` (flow) is a private `file:` types-only package; task/queue cannot use it without publishing | flow findings s5 |
| C-7 | Identity today is the normalized absolute path in all three CLIs (task registry, flow `attachedProjects.includes`, queue `meta.cwd`); name = folder basename | verified |
| C-8 | Registry is `<configDir>/projects.json`, array of absolute dirs, no id/name/metadata; corrupt file fails loudly; edits never delete project data | task CLAUDE.md |
| C-9 | queue merge rule: global + nearest project subscribers both fire; "project overrides global" must never be implemented | queue guiding-principles.md:15-17 |
| C-10 | flow: nearest `.flow/config.yml` wins (nested projects already tested); absence is an error, never a cwd fallback | D#40, D#47, D#50 |
| C-11 | queue replay re-resolves subscribers from recorded `meta.cwd`; falls back to current cwd (with warning) if gone | queue findings s4 |
| C-12 | Subscriber commands run with `shell: true`; no gate for a cloned repo's `.queue/subscribers.yml` | verified CliTransport.ts:37 |

## Inconsistencies found (side effects to decide on)

| # | Finding | Suggested handling |
|---|---|---|
| I-1 | Three resolvers: task exact-dir, flow walk-up (`.flow/config.yml` then `.git`), queue walk-up 20 levels with two markers | Resolved by the shared resolver (Q1) |
| I-2 | task `--config`/`TASK_CONFIG` move config.yml but not projects.json | Fix when registry moves (Q10) |
| I-3 | `--all-projects` rejects `--project-dir` flag but not `TASK_PROJECT_DIR` env | Small task bug; confirm and fix independently |
| I-4 | queue `--scope project` writes to exact cwd, help text says walk-up | Align with shared resolver |
| I-5 | flow `Daemon.ts:236-242` swallows resolver error; `ConfigLoader.ts:135` uses daemon cwd | Violates P-1; fix independently |
| I-6 | queue replay silently targets current cwd if recorded one is gone | Cross-project risk (Q8) |
| I-7 | queue CliTransport is `shell: true` with raw `{{payload}}` | Dropped: all machines trusted (P-2) |
| I-8 | `~/.config/task/projects.json` is `[]` although `_test-flow/.task` exists; cause unknown | Investigate separately |
| I-9 | flow `project-resolution` extension point declared stable, never loaded, 6 hardcoded call sites | Relevant if flow adopts a shared resolver |

## Reported to owners (2026-10-24)

| To | Items |
|---|---|
| flow-owner | I-5 (+ ConfigLoader daemon cwd), I-9, stale docs (.agent-fleet/.flows, pool-architecture Q#20/21) |
| queue-owner | I-6, I-4, two markers, QUEUE_PUSH_CWD doc, missing walk-up tests |
| task-owner | I-3, I-2, I-8, subdir behavior, stale cli-best-practices, shared-cli pin drift |
| app-core-owner | Decision #2 wrongly attributes task to flow-cli |

No reply expected; owners verify on their side.

task-owner reply (2026-10-24): I-3 confirmed and being fixed (flag and TASK_PROJECT_DIR rejected alike; ambient PROJECT_DIR ignored with a visible note). I-8 explained: registration is explicit only (`task init`, `task projects add`, app-core Projects page); `_test-flow/.task` predates the registry. I-2 and subdir walk-up deferred to this spec. New design question for Q10: should a command run inside an initialised project register it implicitly? Pin alignment of shared-cli is theirs, on request.

## task-owner migration offer (2026-10-24)

task is frozen on project work until this spec lands (its user wants one shared concept). Swap surface, all behind task-service: `listRegisteredProjects`, `registerProject`/`unregisterProject`, `addProject`, `relocateProject`, `removeRegisteredProject`, `initProject` registration step, `findProjectByRef`, `projectRef.ts`. Other task facts: registry written by `task init`, `task projects ...` and the app-core Projects page; app-module API uses `?project=<abs dir>`; app-core routes use `/tasks/p/:project/...` with slug `<dir name>~<6 hex>` (breadcrumb drops query params). task-owner needs from the spec: id/name/path/slug, registry location, writers, resolver walk-up rule. Additional requirement for Q2/Q5: the slug must be path-segment safe.

## Question triage

Nothing is pre-decided; evidence narrows the options.

| # | Question | What evidence settles | Still needs the user |
|---|---|---|---|
| 1 | Where does project logic live | C-1..C-5 rule out "put it in shared-cli"; three options remain | Yes |
| 2 | Identity | C-7: path is the de facto key; `name~hash6` slug exists in task | Confirm path-as-key + derived ref |
| 3 | Marker / resolution | C-10: flow nearest-wins already tested; queue/task diverge | Which marker, precedence across `.task/.flow/.queue` |
| 4 | Nesting + inheritance | C-9, C-10: nearest wins; queue concatenates | Yes (scope semantics) |
| 5 | Targeting syntax | task has `--project-dir`; slug exists | Name of flag, ref forms |
| 6 | Project key on daemon stores | `projectRoot`/`cwd` already recorded per record | Mostly a filter feature; low risk |
| 7 | Migration | C-8 format known | After Q1/Q10 |
| 8 | Cross-project permissions | C-12, I-6, I-7 | Yes (security) |
| 9 | Does a `project` CLI binary exist | - | Yes (after Q1) |
| 10 | Registry location/format | C-8, I-2 | After Q1 |
