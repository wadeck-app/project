# @wadeck-app/project-sdk

Zero-dependency SDK for the shared "project" concept of the task, flow and queue CLIs: registry, reference resolution, per-project config/data folders. ESM + CJS, node >= 22. No console output, no `process.exit`: plain functions, plain data, errors thrown.

Every I/O function takes an explicit `registryDir` (no hidden global). `defaultRegistryDir(env, home?)` gives `$XDG_CONFIG_HOME/project`, else `<home>/.config/project` (`home` defaults to `os.homedir()`; pass it in tests).

## Registry layout

```
<registryDir>/
  registry.json            { schemaVersion: 1, projects: Project[] }
  deleted_projects.json    { schemaVersion: 1, projects: (Project & { deletedAt })[] }
  registry.lock            write lock (pid, token, host, createdAt); stale after 30 s without touch
  projects/<id>/<tool>/{config,data}/
```

`Project = { id, name, aliases, parent?, paths: { path, main }[], git?, labels?, createdAt }`. Paths are stored normalized (absolute, forward slashes, uppercase drive letter on Windows).

## Rules

- id: 8 lowercase hex chars. Name/alias: `^[a-z][a-z0-9._-]*$`, max 64, stored lowercase, never id-shaped.
- Names, aliases and ids are unique across live projects, case-insensitive.
- A path belongs to one project; a project with paths has exactly one `main` (the first added); 0 paths = virtual project (`isVirtual`).
- Paths are stored with forward slashes; error messages, the NoProjectInScopeError hint included, show them in the native form (`toNativePath`: backslashes on Windows), while the data of the errors (`cwd`, `path`) stays as stored.
- Paths stay purely string-based (`normalizePath`, `pathKey`), but matching also compares real folders (`fs.realpathSync.native`): a cwd reached through a junction, symlink or 8.3 short name resolves, and registering a link to a folder another project owns is refused. A registered path that no longer exists is matched by its normalized path only.
- Reads (`loadRegistry`) take no lock and skip full validation. A missing `registry.json` (or `deleted_projects.json`) is the first-use state: an empty registry, nothing is created. Every mutation: lock, load, change, `validateRegistry`, atomic write.
- `removeProject` is a soft delete; `projects/<id>/` is never deleted. `restoreProject` brings a project back (see Restore).

## API

| Area | Functions |
|---|---|
| Location | `defaultRegistryDir(env, home?)`, `projectDir(registryDir, id)` |
| Read | `REGISTRY_SCHEMA_VERSION`, `loadRegistry`, `loadDeleted`, `validateRegistry(registry, options?)` (`checkPaths` defaults to false), `registryFilePath`, `deletedFilePath` |
| Labels | `addLabels(registryDir, ref, labels)`, `removeLabels(registryDir, ref, labels)`, `parseLabel`, `formatLabel`, `normalizeProjectLabel`, `labelsOf(project)`, `hasLabel(project, selector)`, `matchesSelectors(project, selectors)`, `filterProjects(registry, selectors)` |
| Projects | `addProject` (`labels?`), `renameProject`, `addAlias`, `removeAlias`, `setParent`, `setGit`, `removeProject(registryDir, ref, { recursive })` |
| Paths | `addPath(.., { main })`, `removePath(.., { newMain })`, `movePath`, `setMain` |
| Options | `extractProjectOption(argv, env, envName)`, `resolveProjectFromArgs(registry, argv, env, envName, cwd)` |
| Lookup | `findProjectIncludingDeleted(registryDir, id)`, `restoreProject(registryDir, ref, { recursive? })` |
| Ids and origin | `formatQualifiedId`, `parseQualifiedId`, `resolveQualifiedId(registry, input, fallback?)`, `buildOrigin(tool, scope?, now?)`, `formatOrigin` |
| Resolution | `resolveReference`, `findProjectForPath`, `resolveScope` (flag > env > cwd; `label` names the source of an explicit reference), `describeResolution`, `requirePath` |
| Inheritance | `getChain`, `getAncestors` (parent first), `getChildren`, `getDescendants` (breadth-first, cycle-safe; the project itself is never included), `getConfigLayers`, `projectToolDir(registryDir, id, tool, kind, { ensure })` with kind `config`, `data`, `cache` or `logs` (`<registryDir>/projects/<id>/<tool>/<kind>`) |
| Config helpers | `validateLayer`, `mergeLayers(schema, layers)`, root-first with the project's own layer last; `ConfigSchema` scopes `global`, `local`, `inherit`; merges `replace`, `deep`, `append`; the CLIs parse the files |
| Infra | `withRegistryLock`, `writeFileAtomic`, `lockFilePath` |
| Helpers | `toNativePath(path, platform?)`, `normalizePath(path, base?)`, `pathKey(path, base?)`, `isSameOrInside`, `assertDirectory`, `generateId`, `isIdLike`, `normalizeLabel`, `deriveName(path)`, `describeProject(project)`, `mainPath(project)`, `isVirtual(project)`, `levenshtein` |

Mutations return the updated `Project` (`removeProject` returns the deleted entries) and accept a trailing `{ lock: { timeoutMs, staleMs, retryMs, onWait } }`; `onWait` is how a CLI prints "waiting for lock held by pid N"; it also fires for a stale lock (`stale: true`) that is about to be taken over.

## Errors

All extend `ProjectError` (`code`, actionable message). Messages name no API option and no CLI flag, so each CLI adds its own hint from typed data. `NoProjectInScopeError.hint` is ready-made advice for a separate line.

| Class | Code (data) |
|---|---|
| `InvalidLabelError` | `INVALID_LABEL` |
| `InvalidProjectLabelError` | `INVALID_PROJECT_LABEL` (`input`, `reason`) |
| `InvalidLabelSelectorError` | `INVALID_LABEL_SELECTOR` (`input`, `reason`) |
| `ProjectLabelNotFoundError` | `PROJECT_LABEL_NOT_FOUND` (`label`, `project`) |
| `InvalidQualifiedIdError` | `INVALID_QUALIFIED_ID` (`input`, `reason`) |
| `RestoreConflictError` | `RESTORE_CONFLICT` (`project`, `conflictsWith?`) |
| `LabelTakenError` | `LABEL_TAKEN` (`kind`, `label`, `owner?`) |
| `InvalidIdError` | `INVALID_ID` |
| `InvalidPathError` | `INVALID_PATH` (`path?`) |
| `PathOwnedError` | `PATH_OWNED` |
| `MainPathError` | `MAIN_PATH` |
| `HasChildrenError` | `HAS_CHILDREN` (`project`, `children`) |
| `InvalidToolError` | `INVALID_TOOL` |
| `AtomicWriteError` | `ATOMIC_WRITE_FAILED` |
| `LockTimeoutError` | `LOCK_TIMEOUT` |
| `LockLostError` | `LOCK_LOST` |
| `RegistryCorruptError` | `REGISTRY_CORRUPT` |
| `RegistryInvalidError` | `REGISTRY_INVALID` |
| `UnsupportedSchemaVersionError` | `UNSUPPORTED_SCHEMA_VERSION` (`file`, `found`, `supported`) |
| `ProjectNotFoundError` | `PROJECT_NOT_FOUND` (`ref`, `suggestions`) |
| `AmbiguousReferenceError` | `AMBIGUOUS_REFERENCE` (`ref`, `candidates`) |
| `NoProjectInScopeError` | `NO_PROJECT_IN_SCOPE` (`cwd`, `registered`, `hint`) |
| `VirtualProjectError` | `VIRTUAL_PROJECT` |
| `DanglingParentError` | `DANGLING_PARENT` |
| `ParentCycleError` | `PARENT_CYCLE` |
| `ConfigSchemaError` | `CONFIG_SCHEMA` |

## Restore

`restoreProject(registryDir, ref, { recursive? })` puts a soft-deleted project back with the same id, name, aliases, paths, labels, git and parent (the data folder was never deleted). `ref` is an exact id, or an exact name or alias (case-insensitive) among the deleted projects; several deleted projects with that name are an `AmbiguousReferenceError` listing their ids and deletion dates (restore by id); no match is a `ProjectNotFoundError` with suggestions.

- It runs in the registry lock with the normal full validation. A collision with a live project (name, alias, path), a path that no longer exists, or a parent that is not live is a `RestoreConflictError` naming what is in the way and the fix; nothing changes.
- With `recursive`, the deleted descendants come back too, parents before children, all or none.
- `registry.json` is written first, then the entry leaves `deleted_projects.json`. After a crash an id may be in both files: it is live, it cannot be restored, and the stale entry is dropped by the next restore or removal.

## Project-qualified ids

Recommended syntax for task, flow and queue to name an id (task, run, event) of another project: `<project>/<id>`, for example `task show shop/abc123`. The project is an id, a name or an alias; a local id never contains `/`. `parseQualifiedId` splits on the first `/` (no `/`: no project part; an empty part or a second `/`: `InvalidQualifiedIdError`), `formatQualifiedId(projectId, localId)` is the inverse, and `resolveQualifiedId(registry, input, fallback?)` resolves the project part like any reference and uses `fallback` (the project in scope) when there is none, failing clearly when there is neither.

## Origin of an action

The shape that task, flow and queue record in the task history, in event payloads and in the hook context when an action crosses projects: `Origin = { tool, at (ISO), projectId?, projectName?, cwd? (stored forward-slash form) }`. `buildOrigin(tool, scope?, now?)` takes the project fields from the scope when there is one (none otherwise, "when available"), never an environment value or a credential. `formatOrigin` gives the human line: `task from shop (3fa9c1d2) at C:\work\shop` (native path) or `task from outside any project`.

## Project labels

Free meta information on a project (`state::production`, `sandbox`): a set of strings in `labels` (always `[]` for a new project; missing in a registry written before labels existed, read as empty; no schema version change).

- A label is `key::value` or a bare `value`, lowercased; each part matches `^[a-z0-9][a-z0-9._-]*$`, at most 64 characters, at most one `::`. Several values for one key are allowed. At most 32 labels per project. `validateRegistry` checks all of it on write.
- `addLabels` is a set operation (an existing label is a no-op). `removeLabels` throws `ProjectLabelNotFoundError` for a label the project does not have, so a typo is loud; nothing is removed then.
- Selectors (`hasLabel`, `matchesSelectors`, `filterProjects`), several are AND, wildcards exist here and never in stored labels:

  | Selector | Matches |
  |---|---|
  | `key::value` | exactly this label |
  | `key::*` | any label with this key (keyed labels only: a bare label has no key) |
  | `*::value` | any label with this value, keyed or bare |
  | `*::*` | any label (a project with at least one label) |
  | `token` | shorthand: a bare label `token`, or any label with the key `token` |

  An invalid selector throws `InvalidLabelSelectorError`, naming it and listing these forms. A `*` in a stored label is an `InvalidProjectLabelError` that says wildcards are for filters.
- Labels are not inherited through the parent chain, and are kept by the soft delete.

## Routing a path or a flag to a project

- A path: `findProjectForPath(registry, cwd)?.project.id` is the way to route a folder to a project (the deepest registered path that contains it wins).
- A git worktree that lies outside every registered path is NOT recognised: add it with `project paths add <ref> <worktree-path>` (the CLIs fail with `NoProjectInScopeError` until then).
- The flag: `extractProjectOption(argv, env, envName)` takes `-p <ref>`, `--project <ref>` or `--project=<ref>` out of the arguments wherever it is (nothing after `--` is read) and reads the environment variable (blank = unset). A flag without value (last, or followed by another flag) and a repeated flag throw `ProjectOptionError` (`kind`, `option`). `resolveProjectFromArgs` adds `resolveScope` (flag, then variable, then cwd) and returns `{ scope, args }`.
- An id kept in a tool's records: `findProjectIncludingDeleted(registryDir, id)` finds the project by exact id, live first, then in `deleted_projects.json` (`{ project, deleted, deletedAt? }`), so the id of a removed project still resolves.

## Config layers

`mergeLayers` takes layers root-first (global, ancestors, the project's own last). A `local` key is read from the last layer only: the same key in an ancestor is valid there but ignored for the merge, and a project that does not set it has no value. `origins` names the layer of each effective value.

A section may declare `fields` (one nested level, e.g. `plugins.github`): `validateLayer` then refuses any other nested key, naming its dotted path (`key 'plugins.gitlab' is not declared ...`), with the same global-only / project-only rules. `ConfigSchemaError` carries `layer`, `key` and, for a nested key, `path`.

## Locking and tool data

The registry lock protects only `registry.json` and `deleted_projects.json`. Consistency of tool data (several files, `task-index.json`, ...) is the tool's own concern in v1. `withRegistryLock` (async) and `writeFileAtomic` (sync) are exported as written and may be used by tools for their own files.

## Callers without a cwd

`resolveScope` needs a cwd. A caller that has none (the app-core module) uses `resolveReference` then `mainPath`.

## Tests

There is no registry override in v1. Isolate tests by setting `XDG_CONFIG_HOME` (and `HOME` / `USERPROFILE`) to a temp dir in the environment of the code under test; never write to the real `~/.config/project`.

## Development

`npm run build` then `npm test` (the multi-process and CJS tests use `dist/`; a missing build fails them).
