# app-module-project

app-core module `project`: pages to browse and change the shared project registry (`<XDG_CONFIG_HOME or ~/.config>/project`). It is the only UI that writes the registry, always through `@wadeck-app/project-sdk` (lock, atomic write, validation), so every change is as safe as one made with the `project` command. Each change is also logged in the daily log of the registry folder.

It is shipped inside the `project` CLI package (`project cli register` tells app-core where it is, see `packages/project-cli/README.md`).

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

Status: 400 invalid, 404 unknown (a removed project says it is in the trash), 409 conflict, 422 invalid registry, 503 lock timeout. `?inlineErrors=true` answers a failure as 200 with `failed`, `httpStatus`, `errorText`; the pages use it so a failing source does not blank the page. A form posts its `ref` field; routes accept and ignore it.

## Slots

The detail page embeds two `ExtensionSlot`s. A contribution is an `extensionPoints` entry `{ "kind": "widget", "slot": "project:<slot>", "view": ... }` in a module that lists `"requires": { "project": "*" }`.

| Slot id | Accepted root `$type` | Use |
|---|---|---|
| `project:project-links` | `ButtonLink`, `IconButton`, `Badge` | Links/buttons about the project, in the header |
| `project:project-panels` | `Section`, `Collapsible`, `Badge`, `ButtonLink` | A section about the project |

Host context: a contribution is rendered with the data of the detail page. Available: `$route.project` (the address segment: id, name or alias) and `$sources.detail.project.*` (`id`, `name`, `aliases`, `labels`, `git`, `parent`, `paths`, ...; see `GET /projects/:ref`). A `$sources` on the contributed node is ignored by app-core: to show data of your own module, use the Related convention below, or a `dslLib` component. Example fixture: `src/backend/__fixtures__/contributor`.

## Related

For data of other modules, the module aggregates it in its backend. A module that has something to say about a project answers:

`GET /api/modules/<its id>/related/project/<projectId>` (`projectId` = 8-hex id)

```json
{ "title": "Tasks", "count": 12, "items": [{ "label": "Fix it", "url": "/modules/task/tasks/p/1a2b3c4d/xyz", "subtitle": "open" }], "moreUrl": "/modules/task/tasks/p/1a2b3c4d" }
```

- `title` (non-empty text) and `items` (list) are required; `count` (whole number), `subtitle` and `moreUrl` are optional.
- Unknown fields (of the answer and of the items) are ignored, so the contract can grow; a wrong type of a known field is a warning.
- Every `url` and `moreUrl` must start with `/modules/` (an external or `//host` address makes the panel invalid).

Status the module answers:

| Status | Meaning | Effect |
|---|---|---|
| 200 | Data | Panel shown |
| 404 | No such route | Module left out |
| 409 | Not applicable to this project (e.g. a virtual project) | Module left out |
| Other, timeout, invalid shape | Failure | Warning shown with the module name |

`GET /projects/:ref/related` asks every other installed module in parallel (2 s each; the list comes from `GET /api/modules` of the same server, on `APP_CORE_PORT`, else the port app-core wrote, else 4850). It answers `{ projectId, hasPanels, panels, summary, rows, warnings, emptyText? }`; `panels` is sorted by module id. A module that fails, times out or answers an invalid shape becomes a `warnings` entry `{ module, text }` shown on the page, never hidden.

## Verified and not verified

Tests cover every route, validation, concurrency, restore, label selector, corrupted-registry safety, the view keys against the installed dsl-ui, and a real app-core server with a packaged contributor (slots accepted, `related` through the real server). A browser rendering of the pages and of the contributed widgets is not covered by the automated tests.
