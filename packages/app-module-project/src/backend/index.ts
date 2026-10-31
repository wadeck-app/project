// violations-suppress: ts/no-barrel-index app-core requires the backend entry of an app-module to be src/backend/index.ts (app-core-cli check)
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { registerReadRoutes } from './readRoutes.js';
import { registerRelatedRoute } from './relatedRoute.js';
import { createRouteKit } from './routeKit.js';
import { registerWriteRoutes } from './writeRoutes.js';

/**
 * backendEntryPath target declared by app-core-cli: called once at module load with the module context.
 * Routes become /api/modules/project/<subPath> and are removed automatically on unload.
 */
export default function (ctx: ModuleContext): void {
  const kit = createRouteKit(ctx);
  registerReadRoutes(kit);
  registerWriteRoutes(kit);
  registerRelatedRoute(kit);
}
