# Structure options -- how to shape the "project" concept

Five independent layers; a design picks a subset. Constraints C-n: `05_constraints-and-triage.md`.

| Layer | What it is | Exists today |
|---|---|---|
| L0 Convention | Written contract: project root marker, nearest-wins resolution, registry file format, ref syntax | No (3 divergent implementations) |
| L1 SDK | Zero-dep package implementing L0 (resolve, registry R/W, refs) | No; blocked from shared-cli by C-1..C-4 |
| L2 `project` CLI | User-facing: list/add/remove/show/resolve/prune, optionally `exec` | Partial: `task projects` |
| L3 Uniform flag | `--project <ref>` in task/flow/queue via L1 | Only `task --project-dir` |
| L4 Authority | Who answers "what projects exist": a file, or a daemon | task: file; flow/queue: own daemons, no project API |

## Candidate structures

| | A Convention only | B Wrapper CLI only | C Layered (L0+L1+L2+L3, file registry) | D Central service |
|---|---|---|---|---|
| Idea | Spec the contract; each repo restates it with shared conformance tests; cross-project via a flag per CLI | `project` CLI with `project exec <ref> -- <cmd>` sets cwd + `TASK_PROJECT_DIR`; other CLIs untouched | A contract + zero-dep SDK + thin `project` CLI + `--project` in each CLI | A daemon (or app-core module) owns the registry; CLIs query it over HTTP |
| Fits C-1..C-6 | Yes (existing restate pattern) | Yes (nothing imported) | Yes, with one new package and a task-service rule exception | Needs task (no daemon today) to depend on a running service |
| Global visibility | Weak: needs registry file implemented 3x | Yes (registry in `project`) | Yes | Yes |
| Drift risk | High: 3 copies of walk-up/precedence | None for resolution; CLIs keep own resolvers | None | None |
| Change per repo | Large (3 repos) | None | Medium (3 repos adopt SDK + flag) | Large, plus a new always-on process |
| Ergonomics | Native `--project` | `project exec B -- task new "x"`: extra verbosity, quoting on Windows, no per-CLI completion | Native `--project` + management CLI | Native, but fails if the service is down |
| Failure mode | Silent divergence | Cwd-based tools still disagree on subdirs (I-1) | Single bug affects all three | Service down = CLIs unusable or fall back silently (violates P-1) |

## Recommendation

C, built in this order so each step is shippable: L0 contract, L1 SDK, L2 `project` CLI, L3 flag per CLI. File registry as authority (task already locks it; flow/queue only record `projectRoot`/`cwd`). Adopt the wrapper (`exec`) inside L2 as a free bonus for tools not yet migrated. Reject D: two of three CLIs have no daemon-friendly path and P-1 forbids silent fallback. Reject A alone: it recreates today's drift.

Open follow-ups: registry format (Q10), per-tool dirs vs unified config (Q11), identity (Q2), nesting (Q4).
