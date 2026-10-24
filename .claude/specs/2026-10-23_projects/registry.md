# Registry -- Projects

**Version:** v0.1
**Last updated:** 2026-10-24
**Status:** Draft

## Overview

Where project metadata and per-project tool config live. Owned and accessed only through `project-sdk`. Does not cover cross-project permissions (Q8) or data location (Q12).

## Decisions

| # | Decision | Rationale | Date |
|---|---|---|---|
| 4 | Registry lives in the config dir (`~/.config/project/...`). Structure: an index `registry.json`, plus one sub-folder per project holding that project's per-tool config (task, queue, flow, ...). Per-tool config must be easy to read from the other CLIs, with inheritance. | User choice: centralized, one place, mirrors how the other CLIs already lay out config | 2026-10-24 |
| 4 | The location is overridable: env var / `--config` for the `project` CLI (same convention as the other CLIs); a registry-config option (user-proposed name: `--project-registry-config=<path>`) for CLIs using the SDK. Purpose: test everything without touching production. | Safe testing | 2026-10-24 |
| 4 | A project has 0-n paths (worktrees, variants); a path can carry a tag such as `main` (user: "maybe"). | Worktrees produce several variants of one project | 2026-10-24 |
| 4 | A project optionally has a git repo. | User requirement | 2026-10-24 |
| 5 | Path rules: a path belongs to exactly one project (registering a held path is refused, error names the owner); a project with >= 1 path has exactly one `main` path; a project may have 0 paths (virtual, e.g. to share config between other projects). The cwd for `--project B` is B's `main` path; a virtual project has none, so cwd-dependent commands fail loudly with the project name. | Unambiguous resolution; defined default path; shared-config projects | 2026-10-24 |
| 9 | Data is centralized with config: each tool's data lives under the project's folder in the config dir and is reached through an SDK data-directory function; nothing is stored in project folders. Flow/queue records are keyed by project id, not path. | Several paths per project make in-folder data diverge per variant; virtual projects and path-independent workers/containers need central data | 2026-10-24 |
| 11 | `--project` / `-p` accepts an id (full or unique prefix), a name or an alias; no paths. A project has 0-n aliases. Matching is case-insensitive. Ambiguity is an error listing candidates. No match: the error suggests the closest names/aliases by Levenshtein distance (display only, never auto-selected). Derived, to confirm: names/aliases/ids cannot collide across projects (refused at registration, error names the owner). | Fast to type; no wrong-target guess (T-01) | 2026-10-24 |
| 12 | A file `.projects-temp-override.json` in the root of the cwd (no walk-up) forces the registry location; the product writes it into the temporary folder it creates for a worker. Every command logs at start how the configuration resolved (registry location + source, project + source). Env var / flags / precedence as proposed in `_index.md` Decision #12, to confirm. | Test isolation without relying on env propagation; no hidden resolution | 2026-10-24 |
| 13 | Writers serialize through a lock file (holder pid inside); stale after 30 s without a touch (mtime); stale takeover is allowed. Derived, to confirm: unique token re-checked before the rename, atomic takeover, periodic touch for long operations, actionable timeout error. | No lost updates; mtime works across machines and pid reuse | 2026-10-24 |
| 15 | Each project's folder is named by its id (`<configDir>/projects/<id>/`), never by name or alias; `project path <ref>` prints it. | Stable under rename, filesystem-safe | 2026-10-24 |
| 16 | Deferred from version 1: the registry-location override (override file, env var, flags, precedence, propagation to children, daemon-vs-registry mismatch). Version 1 uses the default location only. Decisions #4 (overridable) and #12a are amended by this deferral; #12b (log how the configuration resolved) stays. | Get a working feature first; stabilize later if needed | 2026-10-24 |
| 19 | `project remove` is a soft delete: the entry leaves `registry.json` and is appended to `deleted_projects.json`; `projects/<id>/` is kept. Details: Q32. | Never lose data | 2026-10-24 |
| 22 | Optional git repo field: one free value stored as given, no validation, no behavior in version 1. | User asked for the field only | 2026-10-24 |
| 23 | Default location: `$XDG_CONFIG_HOME/project`, else `~/.config/project`. | User confirmation | 2026-10-24 |
| 24 | Amends #19: removing a project with children is an error suggesting `--recursive` (soft-deletes the project and its descendants). | No dangling parents | 2026-10-24 |
| 25 | Cwd with several paths: inside one of the project's paths, that path is used; `main` only when running outside the project. | What `main` is for | 2026-10-24 |
| 26 | Full validation (uniqueness, one `main`, parents/cycles, paths exist) on write only; reads keep cheap loud checks (unreadable JSON, unknown schema version, ambiguous reference). | Path-existence checks are slow | 2026-10-24 |
| 4 | All registry writes (index and per-project files) are atomic (write to temp file, then rename). | User: "atomic write is important"; a half-written index would break every command | 2026-10-24 |

## Design (as stated; unsettled points listed below)

- `registry.json`: index of projects (id, name, aliases, parent id, paths with optional tags, optional git repo).
- `<configDir>/<project>/`: per-tool config sub-folders (task, queue, flow, ...). Folder naming (id vs name) is open.
- The SDK exposes per-tool effective config with inheritance (rule: Q13).
- A flag/env pointing the SDK at a non-production registry must fail loudly if the target is missing or invalid (P-1); a silent fallback to the production registry would defeat the purpose.

## Not decided here

| Point | Where |
|---|---|
| Path lifecycle consequences (to confirm in the CLI design): the first path added becomes `main`; removing the `main` path requires naming a replacement or is refused | follow-up of Decision #5 |
| Shape of the git repo field (URL, local path, both) and what it is used for | Q15 |
| Exact env var names, `--config` precedence, Windows location of `~/.config`; verify against existing CLIs | Q16 |
| Remaining write safety: locking of concurrent read-modify-write, validation on read (atomic write is decided) | Q16, T-04 |
| Fate of legacy in-folder config/data (`.task`, `.flow`, `.queue`) and migration of existing `projects.json`, execution records and WAL entries to id keys | Q7, Q6 |
| Whether `project export` (S11) includes data as well as config | container design, later |
| Implicit registration when a command runs in an unregistered folder | Q17 |

## Security considerations

T-04 (registry is the single trust anchor) stays open until Q16. T-05: one path registered under two projects makes resolution ambiguous (Q14). Pointing a test run at the production registry by omission is a tampering risk; see the fail-loud rule above.
