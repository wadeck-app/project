import type { ModuleContext } from '@wadeck-app/app-core-sdk';

/**
 * Prototype of a module that contributes to the project module (test fixture, copied and packaged by the real-server test).
 * Besides the two slot views, it answers the "related" convention: GET /api/modules/project-contributor/related/project/<projectId>.
 */
export default function (ctx: ModuleContext): void {
  ctx.registerRoute('GET', '/related/project/:projectId', async (req, reply) => {
    const projectId = (req as unknown as { params: { projectId: string } }).params.projectId;
    const out = reply as unknown as { code(status: number): { send(body: unknown): unknown } };
    return out.code(200).send({
      title: 'Fixture items',
      count: 1,
      items: [{ label: `Item of ${projectId}`, url: `/modules/project-contributor/items/${projectId}`, subtitle: 'from the fixture' }],
      moreUrl: `/modules/project-contributor/items?project=${projectId}`,
    });
  });
}
