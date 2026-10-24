# User requirements and scenarios (stated 2026-10-24)

Command syntax below is illustrative, not decided.

## Requirements (user-stated)

| ID | Requirement |
|---|---|
| R-1 | `task`/`flow`/`queue` auto-scope to the current project, found from the folder (registry entry, or the folder's own config when there is no inheritance) |
| R-2 | `--project <name|id>` accepted anywhere in the command, from project A to project B |
| R-3 | Same from outside any project (global context): manipulate task/flow/queue of other projects |
| R-4 | Inheritance chain: global -> C1 -> C2 -> ... |
| R-5 | Project config can be centralized (not only in the project folder) |
| R-6 | Workers can start in a new temporary folder using the project's registered config |
| R-7 | A Docker container can receive the project config automatically, or fetch it dynamically |

| R-8 | Short alias `-p <ref>` for `--project`, in all three CLIs. Checked 2026-10-24: no `-p` in the non-test source or top-level `--help` of task, queue, flow (subcommand help and docs not checked) |

| R-9 | The `project` CLI follows the same auto-update principles as task/flow/queue (details: `08_findings_update-and-release.md`) |

| R-10 | Code lives in `C:\Workspace_Tooling\project`, with the same package layout, CI and release structure as task/flow/orchestrator. Specs move to `project/.claude/specs/` (replaces the `_temp-projects` rule) |

## Scenarios under structure C

| # | Context | Command | Expected |
|---|---|---|---|
| S1 | cwd in A or any subfolder | `task list`, `queue history`, `flow run build` | Scope A (nearest project root) |
| S2 | cwd in A | `task new "fix login" --project B` | Task created in B; flag position free: `task --project B new "x"` |
| S3 | cwd in A | `flow run deploy --project B`, `queue push ci.done --project B` | Runs with B's scope and B's path as cwd |
| S4 | cwd outside any project | `task list --project B` | Works |
| S5 | cwd outside any project | `task new "x"` | Error: "no project in scope; pass --project <ref>. Registered: A, B (see `project list`)" (P-1) |
| S6 | any | `project list`, `project add .`, `project move`, `project remove`, `project prune` | Registry management |
| S7 | any | `project resolve` | Prints the scope in use and why (flag, env, cwd walk-up, none) |
| S8 | any | `project add ./c2 --parent C1`; `project show C2` | Chain global > C1 > C2 with the origin of each effective value |
| S9 | any | `project config set B task.defaults.priority high` | Central config for B |
| S10 | temp dir | `flow worker --project B` | Worker attached to B, config from the registry, cwd unrelated to B |
| S11 | host -> container | `project export B > b.tgz`, mounted or passed to the container | Container starts with B's effective config, no server needed |
| S12 | container, dynamic | `PROJECT_REGISTRY_URL=... flow worker --project B` | Fetches config at start; needs a server (structure D territory) |

## Facts that bear on this

| Fact | Evidence |
|---|---|
| task already strips `--json` and `--project-dir` from anywhere after the command | `args.test.ts:19` |
| `flow worker --project` already means "attach to project": compatible meaning | findings 03 |
| `queue wait ci --repo` is a GitHub repo, not a project: no clash | findings 01 |
| queue push requires `cwd`; `--project` would set it to the project path | QueueService.ts:78-92 |
| Merge semantics differ per tool: queue concatenates global + nearest; flow nearest-wins; task defaults.priority global < project | C-9, C-10 |
| task data lives in `<project>/.task`; flow/queue state is global and keyed by `projectRoot`/`cwd` | findings 01 |

## Questions these requirements raise

| # | Question |
|---|---|
| a | Config vs data: centralize config only, or data too? A temp-dir worker or container can read config from an export, but task data is files in the project folder (no daemon) |
| b | Is the parent declared explicitly in the registry, or implied by folder nesting? C1 -> C2 with unrelated folders needs explicit |
| c | Merge rule per config section (override, append, deep-merge), since the three tools differ today |
| d | Source of truth when both a central config and an in-folder file exist |
| e | Container delivery: static export (no server) first, dynamic fetch later? |
| f | Ref forms (name, id, path, slug) and ambiguity error when a name matches several |
