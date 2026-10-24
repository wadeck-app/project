# Handoff -- Projects spec

Updated 2026-10-24 by `project-owner`. Supersedes the brainstorming handoff (history in git/`_index.md` changelog).

## State

- Spec v0.23: 27 decisions (`_index.md` Decision Log). Open: Q5/Q20 (syntax for another project's ids), Q6 (user-facing filters), Q26 origin format, Q27 ids in URLs and app-core registry discovery, Q29 write target in a chain, Q30 lock coverage of tool data, Q31 queue subscriber lookup, Q32 name reuse and restore. Deferred: registry override and daemon mismatch (Q21, Decision #16).
- Code: `packages/project-sdk` (zero-dependency, tested) and `packages/project-cli` (mini CLI proving the SDK). Pushed to `origin/main`; CI green on ubuntu/windows/macos; `@wadeck-app/project-sdk@2026.10.24-003-30a1bb57` and `@wadeck-app/project-cli@2026.10.24-003-30a1bb57` published (tag `latest`, plain npm packages). No launcher, platform packages or auto-update yet.

## Do next

1. `project-cli` launcher, platform packages and auto-update following `11_findings_repo-layout.md` (avoid the listed pitfalls), extend `publish.yml` to publish it.
2. Support task-owner, flow-owner, queue-owner adopting `project-sdk`; settle Q26, Q27, Q29, Q30, Q31 with them, proposing defaults.
3. Manual migration of existing data when the CLIs are ready (Decision #17).

## User principles

Fail loudly (P-1), all machines trusted (P-2), report bugs to the owning session (P-3); get a working feature first, iterate later; no detail questions that do not block.
