import { defaultRegistryDir, loadRegistry } from '@wadeck-app/project-sdk';
import { appCoreBaseUrl } from './appCore.js';
import { countTextOf, figureOf } from './countText.js';
import { RequestError } from './httpError.js';
import { NegativeCache, collectRelated } from './related.js';
import { findLive } from './readRoutes.js';
import { refOf } from './request.js';
import { type RouteKit, ok } from './routeKit.js';

// Shared by all requests: a module that has nothing for a project is not asked again for a minute.
const negativeCache = new NegativeCache();

const EMPTY_TEXT = 'No other module has anything to show for this project.';

/** The tools that get a tab on the project page: the optionalRequires of the manifest (the page is static YAML, a tab cannot be generated). */
const TOOL_MODULES = ['task', 'queue', 'flow'] as const;

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
        // The link of the column "See all" (the SDK has checked that moreUrl is a /modules/ page); no text, no link, when there is none.
        seeAllText: p.moreUrl === undefined ? '' : 'See all',
        href: p.moreUrl ?? '',
      })),
      rows: panels.flatMap((p) => (p.items ?? []).map((item) => ({ module: p.module, panel: p.title, label: item.label, subtitle: item.subtitle ?? '', href: item.url }))),
      warnings,
      // One tab per tool: what that module says about the project, or why there is nothing (the YAML shows emptyText when it is not empty).
      tabs: Object.fromEntries(
        TOOL_MODULES.map((module) => {
          const panel = panels.find((p) => p.module === module);
          const failure = all.find((p) => p.module === module && p.error !== undefined);
          if (panel === undefined) {
            const emptyText =
              failure === undefined
                ? `The ${module} module has nothing to show for this project (not installed, or no ${module} data for it).`
                : `The ${module} module did not answer: ${failure.error}`;
            return [module, { emptyText, rows: [] }];
          }
          return [
            module,
            {
              emptyText: '',
              title: panel.title,
              countText: countTextOf({ ...panel, items: panel.items ?? [] }),
              // The number alone and what it counts, for the StatTile of the tool.
              ...figureOf({ ...panel, items: panel.items ?? [] }),
              noteText: panel.truncated === true ? 'partial list' : '',
              seeAllText: panel.moreUrl === undefined ? '' : 'See all',
              href: panel.moreUrl ?? '',
              rows: (panel.items ?? []).map((item) => ({ label: item.label, subtitle: item.subtitle ?? '', href: item.url })),
            },
          ];
        }),
      ),
      ...(all.length === 0 ? { emptyText: EMPTY_TEXT } : {}),
    });
  });
}
