# Handoff -- Projects spec

Updated 2026-10-24 by `project-owner`. Supersedes the brainstorming handoff (history in git/`_index.md` changelog).

## State

- Spec v0.23: 27 decisions (`_index.md` Decision Log). Open: Q5/Q20 (syntax for another project's ids), Q6 (user-facing filters), Q26 origin format, Q27 ids in URLs and app-core registry discovery, Q29 write target in a chain, Q30 lock coverage of tool data, Q31 queue subscriber lookup, Q32 name reuse and restore. Deferred: registry override and daemon mismatch (Q21, Decision #16).
- Code: `packages/project-sdk` (zero-dependency, tested) and `packages/project-cli` (CLI with the task/queue distribution stack: Go launcher, 3 platform packages, auto-update via shared-updater, labels, native path messages, invocation logs). Pushed to `origin/main`; CI green on ubuntu/windows/macos; both packages published on every push to main (tag `latest`, CalVer, e.g. `2026.10.25-009-c42722ea`).
- Auto-update verified end to end in an isolated npm prefix and registry dir with real published versions (004 -> 009): background update after the 30 min throttle (cache reset), self-check on the new version, "Updated to ... To go back: project cli rollback" notice, `cli rollback` after several commands, forced `cli update`, `cli logs`. The platform package is installed by the launcher fallback on first run (same as task-cli). Not run: macOS/Linux installs, a real kill of the updater inside `npm install -g`.
- Updater incident (scrapers-owner, 2026-10-25): an updater killed inside `npm install -g` removed the global CLI. Fixed in `@wadeck-app/shared-updater` 019/020; our lockfile had pinned 2026.10.10-017 (all project-cli versions up to 008 bundle the old updater). Now locked at 2026.10.25-020, guarded by `lockfile.test.ts`; `cli update`/`cli rollback` refuse to run from a development build; the notice handles the `applying` status. Keep `package-lock.json` current when shared-updater changes.

## Do next

1. `project-cli` launcher, platform packages and auto-update following `11_findings_repo-layout.md` (avoid the listed pitfalls), extend `publish.yml` to publish it.
2. Support task-owner, flow-owner, queue-owner adopting `project-sdk`; settle Q26, Q27, Q29, Q30, Q31 with them, proposing defaults.
3. Manual migration of existing data when the CLIs are ready (Decision #17).

## User principles

Fail loudly (P-1), all machines trusted (P-2), report bugs to the owning session (P-3); get a working feature first, iterate later; no detail questions that do not block.
