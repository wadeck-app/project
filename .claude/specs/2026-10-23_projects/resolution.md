# Project resolution -- Projects

**Version:** v0.1
**Last updated:** 2026-10-24
**Status:** Draft

## Overview

How a folder or a `--project` ref becomes a project. Implemented once in `project-sdk`; task/flow/queue never resolve on their own.

## Decisions

| # | Decision | Rationale | Date |
|---|---|---|---|
| 2 | Identity = immutable generated id + unique name; path is a mutable attribute | Moves must not orphan records | 2026-10-24 |
| 3 | Registry-only resolution: no marker file in the project folder. The registry is the sole source of id, name and path. The SDK finds the project of a folder by matching the folder against registered paths (deepest registered ancestor wins), with an optimized discovery algorithm. | Simplest model, one source of truth, nothing written into project folders (user choice) | 2026-10-24 |
| 4 | Amends #3: a project has 0-n paths (worktrees, variants), optionally tagged (e.g. `main`). Resolution maps a folder to a (project, path) pair. Details of uniqueness, tags and the 0-path case: Q14. See `registry.md`. | Worktrees give several variants of one project | 2026-10-24 |

| 14 | No implicit registration: a command that needs a project fails in an unregistered folder (cwd, registered projects, exact `project add` command in the error); commands that do not need a project (`--version`, `--help`) are unaffected. | P-1; one registration path | 2026-10-24 |

## Design

- No marker: a folder is a project only if the registry says so.
- Discovery is an SDK concern (index/cache over registered paths); the algorithm is an implementation detail, but behavior must be identical for all CLIs.
- Path normalization (case, drive letter, junctions, long-path prefix) is owned by `project-sdk` and applied on write and on lookup.
- A folder moved outside the tool is not found. Resolution fails loudly with an actionable error (names the cwd, the closest registered path if any, and `project move <ref> <new-path>` / `project add`). Id and history survive only through `project move`.
- A folder with no registered ancestor and no `--project`: error listing registered projects (S5).
- Temp-dir workers and containers (R-6, R-7) have no matching folder: they must pass `--project` and have the registry or an export available.

## Consequences to settle in later questions

| Question | Impact |
|---|---|
| Q10 | The registry is now the only home of ids: format, location and write safety (concurrent writers) are critical |
| Q11, Q12 | "Everything centralized" was stated for resolution; whether config and task data also move out of the project folder is NOT decided here |
| Q7 | Existing per-CLI folders (`.task`, `.flow`, ...) stop being markers; migration must register them |
| Q4, Q13 | Nesting is by registered path (deepest wins) unless an explicit parent is declared |

## Open questions

Q10, Q11, Q12, Q13, Q7.

## Security considerations

Spoofing: no in-folder marker, so a cloned repo cannot claim an existing id (T-03 closed by design). Tampering: the registry is the single trust anchor, a wrong edit re-scopes every command (T-04).
