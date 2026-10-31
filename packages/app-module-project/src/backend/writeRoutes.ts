import {
  type Project,
  addAlias,
  addLabels,
  addPath,
  addProject,
  defaultRegistryDir,
  loadRegistry,
  movePath,
  removeAlias,
  removeLabels,
  removePath,
  removeProject,
  renameProject,
  restoreProject,
  setGit,
  setMain,
  setParent,
  toNativePath,
} from '@wadeck-app/project-sdk';
import { parseBody } from './body.js';
import { RequestError } from './httpError.js';
import { logMutation } from './mutationLog.js';
import { projectRow } from './present.js';
import { findLive } from './readRoutes.js';
import { refOf } from './request.js';
import { type RouteAnswer, type RouteKit, type RouteRequest, ok } from './routeKit.js';

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** The body of a route whose fields are all optional: a request without body is a request with no field. */
const optionalBody = (req: RouteRequest): unknown => (req.body === undefined || req.body === null ? {} : req.body);

/** The answer of a change: the text for the toast of the shell and the project as it is now. */
function changed(message: string, updated: Project): RouteAnswer {
  const registry = loadRegistry(defaultRegistryDir(process.env));
  return ok({ message, project: projectRow(updated, registry) });
}

/** The project the route is about, as it is before the change (its name is part of the answer). */
function before(req: RouteRequest): Project {
  const registryDir = defaultRegistryDir(process.env);
  return findLive(registryDir, loadRegistry(registryDir), refOf(req));
}

const remembered = (what: string, project: Project): void => logMutation(defaultRegistryDir(process.env), `${what} (${project.name}, ${project.id})`);

export function registerWriteRoutes(kit: RouteKit): void {
  kit.route('POST', '/projects', async (req) => {
    const input = parseBody(req.body, { name: 'string', path: 'string?', aliases: 'strings?', labels: 'strings?', parent: 'string?', git: 'string?', virtual: 'boolean?' });
    if (input.virtual === true && input.path !== undefined) {
      throw new RequestError(400, "'virtual' is true but a 'path' is given: a virtual project has no folder", "Drop 'path' to create a virtual project, or drop 'virtual' to register that folder.");
    }
    const { virtual: _virtual, ...fields } = input;
    const registryDir = defaultRegistryDir(process.env);
    const created = await addProject(registryDir, fields);
    remembered('added a project', created);
    const answer = changed(`Added the project ${created.name} (${created.id}).`, created);
    return { ...answer, status: 201 };
  });

  kit.route('PUT', '/projects/:ref/name', async (req) => {
    const { name } = parseBody(req.body, { ref: 'ignored?', name: 'string' });
    const old = before(req);
    const updated = await renameProject(defaultRegistryDir(process.env), old.id, name);
    remembered(`renamed from '${old.name}'`, updated);
    return changed(`Renamed '${old.name}' to '${updated.name}'.`, updated);
  });

  kit.route('POST', '/projects/:ref/aliases', async (req) => {
    const { alias } = parseBody(req.body, { ref: 'ignored?', alias: 'string' });
    const updated = await addAlias(defaultRegistryDir(process.env), before(req).id, alias);
    remembered('added an alias', updated);
    return changed(`Added the alias '${alias}' to ${updated.name}.`, updated);
  });

  kit.route('DELETE', '/projects/:ref/aliases', async (req) => {
    const { alias } = parseBody(req.body, { ref: 'ignored?', alias: 'string' });
    const updated = await removeAlias(defaultRegistryDir(process.env), before(req).id, alias);
    remembered('removed an alias', updated);
    return changed(`Removed the alias '${alias}' from ${updated.name}.`, updated);
  });

  kit.route('POST', '/projects/:ref/labels', async (req) => {
    const { labels } = parseBody(req.body, { ref: 'ignored?', labels: 'strings?' });
    if (labels === undefined) {
      throw new RequestError(400, "the field 'labels' is required", "Give one or more labels, e.g. 'state::production'.");
    }
    const updated = await addLabels(defaultRegistryDir(process.env), before(req).id, labels);
    remembered(`added ${plural(labels.length, 'label')}`, updated);
    return changed(`Added ${plural(labels.length, 'label')} to ${updated.name}.`, updated);
  });

  kit.route('DELETE', '/projects/:ref/labels', async (req) => {
    const { labels } = parseBody(req.body, { ref: 'ignored?', labels: 'strings?' });
    if (labels === undefined) {
      throw new RequestError(400, "the field 'labels' is required", 'Give one or more labels of the project to remove.');
    }
    const updated = await removeLabels(defaultRegistryDir(process.env), before(req).id, labels);
    remembered(`removed ${plural(labels.length, 'label')}`, updated);
    return changed(`Removed ${plural(labels.length, 'label')} from ${updated.name}.`, updated);
  });

  kit.route('PUT', '/projects/:ref/parent', async (req) => {
    const { parent } = parseBody(req.body, { ref: 'ignored?', parent: 'string' });
    const updated = await setParent(defaultRegistryDir(process.env), before(req).id, parent);
    remembered('changed the parent', updated);
    const parentName = loadRegistry(defaultRegistryDir(process.env)).projects.find((p) => p.id === updated.parent)?.name ?? parent;
    return changed(`Set the parent of ${updated.name} to ${parentName}.`, updated);
  });

  kit.route('DELETE', '/projects/:ref/parent', async (req) => {
    parseBody(optionalBody(req), { ref: 'ignored?' });
    const updated = await setParent(defaultRegistryDir(process.env), before(req).id, null);
    remembered('cleared the parent', updated);
    return changed(`Cleared the parent of ${updated.name}.`, updated);
  });

  kit.route('PUT', '/projects/:ref/git', async (req) => {
    const { git } = parseBody(req.body, { ref: 'ignored?', git: 'string' });
    const updated = await setGit(defaultRegistryDir(process.env), before(req).id, git);
    remembered('changed the git url', updated);
    return changed(`Set the git url of ${updated.name}.`, updated);
  });

  kit.route('DELETE', '/projects/:ref/git', async (req) => {
    parseBody(optionalBody(req), { ref: 'ignored?' });
    const updated = await setGit(defaultRegistryDir(process.env), before(req).id, null);
    remembered('cleared the git url', updated);
    return changed(`Cleared the git url of ${updated.name}.`, updated);
  });

  kit.route('POST', '/projects/:ref/paths', async (req) => {
    const { path, main } = parseBody(req.body, { ref: 'ignored?', path: 'string', main: 'boolean?' });
    const updated = await addPath(defaultRegistryDir(process.env), before(req).id, path, main === true ? { main: true } : {});
    remembered('added a path', updated);
    return changed(`Added the path ${toNativePath(path)} to ${updated.name}.`, updated);
  });

  kit.route('DELETE', '/projects/:ref/paths', async (req) => {
    const { path, newMain } = parseBody(req.body, { ref: 'ignored?', path: 'string', newMain: 'string?' });
    const updated = await removePath(defaultRegistryDir(process.env), before(req).id, path, newMain === undefined ? {} : { newMain });
    remembered('removed a path', updated);
    return changed(`Removed the path ${toNativePath(path)} from ${updated.name}.`, updated);
  });

  kit.route('PUT', '/projects/:ref/paths', async (req) => {
    const { from, to } = parseBody(req.body, { ref: 'ignored?', from: 'string', to: 'string' });
    const updated = await movePath(defaultRegistryDir(process.env), before(req).id, from, to);
    remembered('moved a path', updated);
    return changed(`Moved the path ${toNativePath(from)} to ${toNativePath(to)} for ${updated.name}.`, updated);
  });

  kit.route('PUT', '/projects/:ref/main', async (req) => {
    const { path } = parseBody(req.body, { ref: 'ignored?', path: 'string' });
    const updated = await setMain(defaultRegistryDir(process.env), before(req).id, path);
    remembered('changed the main path', updated);
    return changed(`Set ${toNativePath(path)} as the main path of ${updated.name}.`, updated);
  });

  kit.route('DELETE', '/projects/:ref', async (req) => {
    const { recursive } = parseBody(optionalBody(req), { ref: 'ignored?', recursive: 'boolean?' });
    const target = before(req);
    const removed = await removeProject(defaultRegistryDir(process.env), target.id, recursive === true ? { recursive: true } : {});
    removed.forEach((entry) => remembered('removed a project', entry));
    const others = removed.length - 1;
    const message = others === 0 ? `Removed ${target.name}. It is in the trash and can be restored.` : `Removed ${target.name} and ${plural(others, 'descendant')}. They are in the trash and can be restored.`;
    return ok({ message, removed: removed.map((entry) => ({ id: entry.id, name: entry.name })) });
  });

  kit.route('POST', '/deleted/:ref/restore', async (req) => {
    const { recursive } = parseBody(optionalBody(req), { ref: 'ignored?', recursive: 'boolean?' });
    const restored = await restoreProject(defaultRegistryDir(process.env), refOf(req), recursive === true ? { recursive: true } : {});
    restored.forEach((entry) => remembered('restored a project', entry));
    const first = restored[0];
    const others = restored.length - 1;
    const message = others <= 0 ? `Restored ${first?.name ?? refOf(req)}.` : `Restored ${first?.name} and ${plural(others, 'descendant')}.`;
    return ok({ message, restored: restored.map((entry) => ({ id: entry.id, name: entry.name })) });
  });
}
