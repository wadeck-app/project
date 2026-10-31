# Handoff -- Projects spec

Updated 2026-10-31 by `project-owner`. Supersedes the earlier handoffs (history in git and the `_index.md` changelog).

## State

- Spec: 30 decisions (`_index.md` Decision Log); every question is resolved except Q21 (registry override and daemon-vs-registry mismatch), deferred by Decision #16.
- Code: `packages/project-sdk` (zero-dependency) and `packages/project-cli` (Go launcher, 3 platform packages, auto-update via shared-updater, labels with wildcard selectors, restore, native path messages, invocation logs). Published from CI on every push to `main` (tag `latest`, CalVer, latest verified `2026.10.27-014-cac65567`); CI runs build+test on ubuntu/windows/macos and a post-publish `verify-install` job (install, self-check, smoke scenario, real update and rollback) on the three OS.
- Adoption (verified in the repos 2026-10-31): task, queue and flow depend on `project-sdk`; none keeps its own project resolution; `-p/--project` and `<TOOL>_PROJECT` go through `extractProjectOption` (task, queue) or a parser with a conformance test against it (flow, commander). Queue routes events to the project and its ancestors, `to-children` opt-in, virtual projects can emit. orchestrator and app-core have no project concept (checked in the code).
- Migration of the existing data (Decision #17, by hand) is done for `test-flow` and `test-tasks`: queue subscribers and task data now live in the registry (`~/.config/project/projects/<id>/`).
- Auto-update verified end to end with real published versions in an isolated npm prefix: background update, self-check, notice, `cli rollback`, forced update, logs. Linux: not a goal (ci-templates: "three platforms only, no Linux"); the CI Linux leg runs `project.cjs` with node.
- Updater incident (scrapers-owner, 2026-10-25): fixed in `@wadeck-app/shared-updater` 019/020 and the shared `ReleaseVersion` guard in shared-cli 044; keep `package-lock.json` current (`lockfile.test.ts` enforces minimums).

## Not verified

- A real kill of the updater inside `npm install -g` and the repair after it (only fake states are tested).
- A parent/child hierarchy on the real registry (covered by tests; the real registry has none).
- The `project` command on Linux.

## Do next

1. Re-verify a repo when its owner reports a change (task: note on stderr for an ignored `-p` shipped; flow: ships the conformance test with its next push).
2. Optional adoption by the CLIs of qualified ids (`<project>/<id>`), `Origin` and `project restore`: owners decide, no deadline.
3. Keep `package-lock.json` (shared-cli, shared-updater) current when those packages change.
4. Q21 only if the user wants the registry override back.

## User principles

Fail loudly (P-1), all machines trusted (P-2), report bugs to the owning session (P-3); get a working feature first, iterate later; no detail questions that do not block; autonomy on commit, push, CI and updates.
