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
- Paths stay purely string-based (`normalizePath`, `pathKey`), but matching also compares real folders (`fs.realpathSync.native`): a cwd reached through a junction, symlink or 8.3 short name resolves, and registering a link to a folder another project owns is refused. A registered path that no longer exists is matched by its normalized path only.
- Reads (`loadRegistry`) take no lock and skip full validation. A missing `registry.json` (or `deleted_projects.json`) is the first-use state: an empty registry, nothing is created. Every mutation: lock, load, change, `validateRegistry`, atomic write.
- `removeProject` is a soft delete; `projects/<id>/` is never deleted.

## API

| Area | Functions |
|---|---|
| Location | `defaultRegistryDir(env, home?)`, `projectDir(registryDir, id)` |
| Read | `REGISTRY_SCHEMA_VERSION`, `loadRegistry`, `loadDeleted`, `validateRegistry(registry, options?)` (`checkPaths` defaults to false), `registryFilePath`, `deletedFilePath` |
| Labels | `addLabels(registryDir, ref, labels)`, `removeLabels(registryDir, ref, labels)`, `parseLabel`, `formatLabel`, `normalizeProjectLabel`, `labelsOf(project)`, `hasLabel(project, selector)`, `matchesSelectors(project, selectors)`, `filterProjects(registry, selectors)` |
| Projects | `addProject` (`labels?`), `renameProject`, `addAlias`, `removeAlias`, `setParent`, `setGit`, `removeProject(registryDir, ref, { recursive })` |
| Paths | `addPath(.., { main })`, `removePath(.., { newMain })`, `movePath`, `setMain` |
| Resolution | `resolveReference`, `findProjectForPath`, `resolveScope` (flag > env > cwd; `label` names the source of an explicit reference), `describeResolution`, `requirePath` |
| Inheritance | `getChain`, `getConfigLayers`, `projectToolDir(registryDir, id, tool, 'config' or 'data', { ensure })` |
| Config helpers | `validateLayer`, `mergeLayers(schema, layers)`, root-first with the project's own layer last; `ConfigSchema` scopes `global`, `local`, `inherit`; merges `replace`, `deep`, `append`; the CLIs parse the files |
| Infra | `withRegistryLock`, `writeFileAtomic`, `lockFilePath` |
| Helpers | `normalizePath(path, base?)`, `pathKey(path, base?)`, `isSameOrInside`, `assertDirectory`, `generateId`, `isIdLike`, `normalizeLabel`, `deriveName(path)`, `describeProject(project)`, `mainPath(project)`, `isVirtual(project)`, `levenshtein` |

Mutations return the updated `Project` (`removeProject` returns the deleted entries) and accept a trailing `{ lock: { timeoutMs, staleMs, retryMs, onWait } }`; `onWait` is how a CLI prints "waiting for lock held by pid N"; it also fires for a stale lock (`stale: true`) that is about to be taken over.

## Errors

All extend `ProjectError` (`code`, actionable message). Messages name no API option and no CLI flag, so each CLI adds its own hint from typed data. `NoProjectInScopeError.hint` is ready-made advice for a separate line.

| Class | Code (data) |
|---|---|
| `InvalidLabelError` | `INVALID_LABEL` |
| `InvalidProjectLabelError` | `INVALID_PROJECT_LABEL` (`input`, `reason`) |
| `InvalidLabelSelectorError` | `INVALID_LABEL_SELECTOR` (`input`, `reason`) |
| `ProjectLabelNotFoundError` | `PROJECT_LABEL_NOT_FOUND` (`label`, `project`) |
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

## Config layers

`mergeLayers` takes layers root-first (global, ancestors, the project's own last). A `local` key is read from the last layer only: the same key in an ancestor is valid there but ignored for the merge, and a project that does not set it has no value. `origins` names the layer of each effective value.

## Locking and tool data

The registry lock protects only `registry.json` and `deleted_projects.json`. Consistency of tool data (several files, `task-index.json`, ...) is the tool's own concern in v1. `withRegistryLock` (async) and `writeFileAtomic` (sync) are exported as written and may be used by tools for their own files.

## Callers without a cwd

`resolveScope` needs a cwd. A caller that has none (the app-core module) uses `resolveReference` then `mainPath`.

## Tests

There is no registry override in v1. Isolate tests by setting `XDG_CONFIG_HOME` (and `HOME` / `USERPROFILE`) to a temp dir in the environment of the code under test; never write to the real `~/.config/project`.

## Development

`npm run build` then `npm test` (the multi-process and CJS tests use `dist/`; a missing build fails them).
