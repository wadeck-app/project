import {
  type Project,
  type Registry,
  defaultRegistryDir,
  filterProjects,
  findProjectIncludingDeleted,
  loadDeleted,
  loadRegistry,
  resolveReference,
  toNativePath,
} from '@wadeck-app/project-sdk';
import { RequestError } from './httpError.js';
import { detailForms, detailOptions, parentChoices } from './options.js';
import { deletedRow, detailOf, projectRow, treeRows } from './present.js';
import { queryList, queryValue, refOf } from './request.js';
import { type RouteKit, ok } from './routeKit.js';

const EMPTY_TEXT = "No project is registered yet. Add one with the form below, or with 'project add' in a terminal.";

/** True when the text is in the id, the name, an alias, a label or a path of the project (case ignored). */
function matchesText(project: Project, text: string): boolean {
  const wanted = text.toLowerCase();
  const haystack = [project.id, project.name, ...project.aliases, ...(project.labels ?? []), ...project.paths.flatMap((p) => [p.path, toNativePath(p.path)])];
  return haystack.some((item) => item.toLowerCase().includes(wanted));
}

/** The project of a reference. A reference to a removed project says where it is (the trash) instead of "not found". */
export function findLive(registryDir: string, registry: Registry, ref: string): Project {
  try {
    return resolveReference(registry, ref);
  } catch (error) {
    const id = ref.trim().toLowerCase();
    const found = /^[0-9a-f]{8}$/.test(id) ? findProjectIncludingDeleted(registryDir, id) : undefined;
    if (found?.deleted === true) {
      throw new RequestError(404, `the project '${found.project.name}' (${found.project.id}) was removed on ${found.deletedAt ?? 'an unknown date'} and is in the trash`, 'Restore it from the Trash page.');
    }
    throw error;
  }
}

export function registerReadRoutes(kit: RouteKit): void {
  kit.route('GET', '/projects', async (req) => {
    const registry = loadRegistry(defaultRegistryDir(process.env));
    const selectors = queryList(req.query, 'label');
    const text = queryValue(req.query, 'q');
    const byLabel = filterProjects(registry, selectors);
    const shown = text === undefined ? byLabel : byLabel.filter((p) => matchesText(p, text));
    return ok({
      ready: true,
      count: shown.length,
      total: registry.projects.length,
      projects: shown.map((p) => projectRow(p, registry)),
      parentOptions: parentChoices(registry.projects),
      ...(registry.projects.length === 0 ? { emptyText: EMPTY_TEXT } : {}),
    });
  });

  kit.route('GET', '/projects/:ref', async (req) => {
    const registryDir = defaultRegistryDir(process.env);
    const registry = loadRegistry(registryDir);
    const project = findLive(registryDir, registry, refOf(req));
    return ok({ project: detailOf(registryDir, registry, project), options: detailOptions(registry, project), forms: detailForms(project) });
  });

  kit.route('GET', '/tree', async () => {
    const { rows, warnings } = treeRows(loadRegistry(defaultRegistryDir(process.env)));
    return ok({ rows, warnings, warningsText: warnings.join(' '), ...(rows.length === 0 ? { emptyText: EMPTY_TEXT } : {}) });
  });

  kit.route('GET', '/deleted', async () => {
    const registryDir = defaultRegistryDir(process.env);
    const deleted = loadDeleted(registryDir).projects;
    const live = loadRegistry(registryDir).projects;
    return ok({
      count: deleted.length,
      projects: deleted.map((entry) => deletedRow(entry, deleted, live)),
      options: deleted.map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.id})` })),
      ...(deleted.length === 0 ? { emptyText: 'The trash is empty.' } : {}),
    });
  });
}
