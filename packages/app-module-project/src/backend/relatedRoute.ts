import { defaultRegistryDir, loadRegistry } from '@wadeck-app/project-sdk';
import { appCoreBaseUrl } from './appCore.js';
import { countTextOf } from './countText.js';
import { RequestError } from './httpError.js';
import { NegativeCache, collectRelated } from './related.js';
import { findLive } from './readRoutes.js';
import { refOf } from './request.js';
import { type RouteKit, ok } from './routeKit.js';

// Shared by all requests: a module that has nothing for a project is not asked again for a minute.
const negativeCache = new NegativeCache();

const EMPTY_TEXT = 'No other module has anything to show for this project.';

function baseUrl(): string {
  try {
    return appCoreBaseUrl(process.env);
  } catch (error) {
    // A malformed APP_CORE_PORT: said as it is (the message names the variable), a mistake of the environment, not of the request.
    throw new RequestError(500, error instanceof Error ? error.message : String(error), 'Fix or unset APP_CORE_PORT, then restart app-core.');
  }
}

export function registerRelatedRoute(kit: RouteKit): void {
  kit.route('GET', '/projects/:ref/related', async (req) => {
    const registryDir = defaultRegistryDir(process.env);
    const project = findLive(registryDir, loadRegistry(registryDir), refOf(req));
    const all = await collectRelated(project.id, { baseUrl: baseUrl(), cache: negativeCache });
    const panels = all.filter((p) => p.error === undefined);
    const warnings = all.filter((p) => p.error !== undefined).map((p) => ({ module: p.module, text: `${p.module}: ${p.error}` }));
    return ok({
      projectId: project.id,
      hasPanels: panels.length > 0,
      panels,
      // One line per panel and one line per item, for the tables of the page (a table row opens `href`).
      summary: panels.map((p) => ({
        module: p.module,
        title: p.title,
        countText: countTextOf({ ...p, items: p.items ?? [] }),
        noteText: p.truncated === true ? 'partial list' : '',
        href: p.moreUrl ?? '',
      })),
      rows: panels.flatMap((p) => (p.items ?? []).map((item) => ({ module: p.module, panel: p.title, label: item.label, subtitle: item.subtitle ?? '', href: item.url }))),
      warnings,
      ...(all.length === 0 ? { emptyText: EMPTY_TEXT } : {}),
    });
  });
}
