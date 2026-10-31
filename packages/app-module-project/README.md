# app-module-project

app-core module `project`: pages to browse and change the shared project registry (`<XDG_CONFIG_HOME or ~/.config>/project`). It is the only UI that writes the registry, always through `@wadeck-app/project-sdk` (lock, atomic write, validation), so every change is as safe as one made with the `project` command. Each change is also logged in the daily log of the registry folder.

It is shipped inside the `project` CLI package. The first registration in app-core is explicit: run `project cli register` once (see `packages/project-cli/README.md`); updates then keep it current, `project cli unregister` removes it.

Scripts: `npm run check` (layout and manifest), `BUNDLE_VERSION=<v> npm run bundle` (packages into `dist-module`), `npm test`.

## Pages

| Menu | Path | Content |
|---|---|---|
| Projects | `/` | Table (id, name, aliases, parent, labels, main path, virtual marker), label-selector filter, text filter, add form |
| Tree | `/tree` | Hierarchy, children indented under their parent |
| Trash | `/deleted` | Removed projects, restore form |
| (route) | `/p/:project` | Detail of one project (`:project` = id, name or alias) and all its changes |

The label filter takes the syntax of `project list --label` (`key::value`, wildcard `state::*`); an invalid selector is shown on the page. The page UI takes one selector; the API accepts several.

## API

Base `/api/modules/project`. Bodies are JSON objects; an unknown field is a 400. Errors answer `{ error: <code>, message, hint? }`, where `message` is the SDK message followed by what to do. Mutations answer `{ message, project | removed | restored }`.

| Route | Body / query |
|---|---|
| `GET /projects` | `label` (repeatable, AND), `q` (text) |
| `GET /projects/:ref` | detail, with `options` and `forms` for the page |
| `GET /projects/:ref/related` | see Related |
| `GET /tree`, `GET /deleted` | |
| `POST /projects` | `name`, `path?`, `aliases?`, `labels?`, `parent?`, `git?`, `virtual?` (201) |
| `PUT /projects/:ref/name` | `name` |
| `POST` / `DELETE /projects/:ref/aliases` | `alias` |
| `POST` / `DELETE /projects/:ref/labels` | `labels` (list or text) |
| `PUT /projects/:ref/parent`, `DELETE` | `parent` |
| `PUT /projects/:ref/git`, `DELETE` | `git` |
| `POST /projects/:ref/paths` | `path`, `main?` |
| `DELETE /projects/:ref/paths` | `path`, `newMain?` |
| `PUT /projects/:ref/paths` | `from`, `to` (move) |
| `PUT /projects/:ref/main` | `path` |
| `DELETE /projects/:ref` | `recursive?` (needed with children); goes to the trash |
| `POST /deleted/:ref/restore` | `recursive?` |

Status: 400 invalid, 403 refused origin, 404 unknown (a removed project says it is in the trash), 409 conflict, 415 wrong content type, 422 invalid registry, 503 lock timeout. `?inlineErrors=true` answers a failed read as 200 with `failed`, `httpStatus`, `errorText`; the pages use it so a failing source does not blank the page (a failed change is never answered as data). A form posts its `ref` field; routes accept and ignore it.

### Security of the routes that change something

app-core listens on the loopback only, but a page of another site open in the same browser can still reach it. Every `POST`, `PUT` and `DELETE` is refused unless:

| Rule | Refusal | Against |
|---|---|---|
| `Content-Type: application/json`, even without a body | 415 | cross-site forms and `text/plain` requests (sent without a preflight) |
| `Host` is `127.0.0.1`, `localhost` or `[::1]` (any port) | 403 | DNS rebinding |
| `Origin`, when present, has the same host as `Host` | 403 | requests from another site |

A client that is not a browser sends no `Origin` and passes if it sends the other two. Read routes are unchanged.

## Slots

### What other modules can add to the project page

The detail page embeds two `ExtensionSlot`s. A contributor lists `"requires": { "project": "*" }` (or `optionalRequires` if it works without this module) and adds an `extensionPoints` entry `{ "kind": "widget", "slot": "project:<slot>", "view": ... }`.

| Slot id | Accepted root `$type` | Use |
|---|---|---|
| `project:project-links` | `ButtonLink`, `IconButton`, `Badge` | Links/buttons about the project, in the header |
| `project:project-panels` | `Section`, `Collapsible`, `Badge`, `ButtonLink` | A section about the project |

Host context: a contribution is rendered with the data of the detail page. Available: `$route.project` (the address segment: id, name or alias) and `$sources.detail.project.*` (`id`, `name`, `aliases`, `labels`, `git`, `parent`, `paths`, ...; see `GET /projects/:ref`). A `$sources` on the contributed node is ignored by app-core: to show data of your own module, use the Related contract below, or a `dslLib` component. Example fixture: `src/backend/__fixtures__/contributor`.

### What this module adds to the pages of others (`optionalRequires`)

`manifest.json` has `"optionalRequires": { "task": "*", "queue": "*", "flow": "*" }` and **never `requires`**: this module works without any of them. A contribution to a module that is not loaded is **inactive** (`GET /api/modules` gives the module a `warnings` list and the extension point an `inactive` reason; app-core logs it once); it activates when the provider loads, even later, and deactivates when it goes away. Nobody is unloaded either way.

| Slot | Accepts | Host context used | Shown when |
|---|---|---|---|
| `task:project-header` | `ButtonLink`, `IconButton`, `Badge` | `$route.project` | the page is the page of a project |
| `queue:project-header` | `Badge`, `Link`, `ButtonLink` | `$sources.projectScope` = `{ id, name, found }` | `found` is true |
| `flow:execution-project-header` | `ButtonLink`, `IconButton`, `Badge`, `Link` | `$sources.execution.projectId` | the execution has a project (old ones do not) |
| `flow:executions-project-header` | same | only the URL parameter `project` | **no contribution**, see below |

What a contributed node can and cannot do (checked in a browser against fixtures of the hosts, `src/backend/__fixtures__/providers`):

- `$if` on a host path works, and so does a label read from a host source (`label: $sources.execution.projectLabel`).
- A prop is an expression only when the WHOLE value is one path (`to: $sources.x.href`). A path inside a string is **not** interpolated: `to: /modules/project/p/$route.project` is followed as it is. A contribution therefore cannot build `/modules/project/p/<id>`: the three links go to the project registry (`/modules/project/`, label "Projects"). To open the page of the project, a host must give a ready-made address in one of its sources (a whole value).
- `$urlParam.*` is not in the context of a contributed node (the link never rendered): `flow:executions-project-header` has nothing to read, so nothing is contributed there until the host copies the value into a source.

**Independence is guarded**: `src/backend/contributions.test.ts` fails if `manifest.json` gets a `requires`, if `optionalRequires` is not exactly task/queue/flow, if a widget targets a module that is not in `optionalRequires`, or if `package.json` lists a provider. `src/backend/optional.integration.test.ts` loads the module in a real app-core without any provider (it loads, warns, works), then loads fixtures of the providers one by one (each activates its contributions) and removes one (it deactivates, nothing is unloaded). `app-core-cli check` / `package` print one warning per provider they cannot find and exit 0; they only find a provider listed in `package.json` (`--link` is keyed by the package name), so the test validates the root `$type`s against the slots on a copy of the module that lists them, including the real built modules of task, queue and flow when their repositories are next to this one.

## Related

The contract lives in `@wadeck-app/project-sdk` (`RelatedPanel`, `parseRelatedResponse`, `buildRelatedResponse`, `assertRelatedResponse`, `isModuleUrl`; see its README). A module that has something to say about a project answers `GET /api/modules/<its id>/related/project/<projectId>` (`projectId` = 8-hex id):

```json
{ "title": "Tasks", "count": 3, "countLabel": "open", "truncated": true, "items": [{ "label": "Fix it", "url": "/modules/task/tasks/p/1a2b3c4d/xyz", "subtitle": "open" }], "moreUrl": "/modules/task/tasks/p/1a2b3c4d" }
```

Unknown fields are ignored; a wrong type of a known field, or a `url` / `moreUrl` that is not a `/modules/...` page (external, `//host`, scheme), makes the panel invalid.

| Status the module answers | Meaning | Effect |
|---|---|---|
| 200 | Data | Panel shown, with the count ("3 open") and a "partial list" note when `truncated` |
| 404 | No such route | Module left out, not asked again for 60 s |
| 409 | Not applicable to this project (e.g. a virtual project) | Module left out, not asked again for 60 s |
| Other, timeout (2 s), invalid shape | Failure | Warning shown with the module name, asked again at the next request |

The 60 s memory is in the process, keyed by module id and project id. `GET /projects/:ref/related` asks every other installed module in parallel (the list comes from `GET /api/modules` of the same server, on `APP_CORE_PORT`, else the port app-core wrote, else 4850). It answers `{ projectId, hasPanels, panels, summary, rows, warnings, emptyText? }`; `panels` is sorted by module id and `warnings` entries are `{ module, text }`, never hidden.

## Verified and not verified

Tests cover every route, validation, concurrency, restore, label selector, the protection of the write routes, corrupted-registry safety, the view keys against the installed dsl-ui, and a real app-core server with a packaged contributor (slots accepted, `related` through the real server, foreign Host/Origin refused). The pages were also driven in a browser by hand (list, filter, detail, add, rename error, remove with confirmation, restore, contributed widgets); that is not automated.
