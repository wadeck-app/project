# Inheritance -- Projects

**Version:** v0.1
**Last updated:** 2026-10-24
**Status:** Draft

## Overview

How a project's effective config is built from its ancestors. Does not cover the per-section merge rule (open, Q13) or where config files live (`registry.md`).

## Decisions

| # | Decision | Rationale | Date |
|---|---|---|---|
| 6 | Each project has an optional explicit single `parent` (project id) stored in the registry. Chain: global > parent > ... > project. | Supports virtual shared-config projects; no accidental inheritance | 2026-10-24 |
| 6 | Folder nesting has no config meaning. | Nesting would silently change chains and fails for virtual projects and multi-path projects | 2026-10-24 |
| 6 | Setting a parent that creates a cycle is refused; a parent id missing from the registry is an error at resolution, not a skip. | Fail loudly (P-1), no resolution loop | 2026-10-24 |
| 6 | One parent only. | Single chain is enough for now (user chose A, did not request multiple) | 2026-10-24 |
| 7 | Merge rule = strategy per config section, declared by the owning CLI, from a fixed set in `project-sdk` (replace, deep-merge, append; default deep-merge, child wins). The declaration must be explicit, enforced and visible in the configuration. Mechanism: Q19. | Preserves current per-tool behavior with one implementation; user requires enforcement | 2026-10-24 |
| 8 | Mechanism: each CLI exports a schema declaring scope (global-only / local / inheritable) and merge strategy per section. `project-sdk` validates files against it (misplaced key = error, no silent ignore) and `project show` displays the rules. Files keep plain key names; optional `global.` / `local.` prefixes may be added later and are not required. | Contract is defined once in the SDK; no format change in task/flow/queue now | 2026-10-24 |

## Current behavior (verified 2026-10-24)

| Tool | Behavior | Evidence |
|---|---|---|
| task | `defaults.priority`: project ?? global ?? built-in; hooks kept apart as `globalHooks` / `projectHooks`; statuses/types project-only | `TaskConfigLoader.ts:118-130` |
| flow | project file schema is plugins only; `queue.*`, `logs.*`, `worker.*` are global-only; a `queue:` key in a project file is silently ignored (violates P-1) | `_test-flow/.flow/config.yml:7-10` (comment, not checked in code) |
| queue | global then nearest project subscribers, concatenated per event; `--scope global\|project` on writes | `_test-flow/.queue/subscribers.yml`, spec `01_current-state.md` |

## Design

- `project show <ref>` lists the chain and the origin of each effective value (S8).
- A possible UX hint at `project add` when the new path lies inside a registered project is not part of the decision (can be added later without a data-model change).

## Open questions

Per-section merge rule: today queue concatenates global + nearest, flow nearest-wins, task layers `defaults.priority` global < project (C-9, C-10).

## Security considerations

T-02: hooks/subscribers are inherited only from a declared parent. T-06: a cycle or a dangling parent id must not loop or silently truncate the chain.
