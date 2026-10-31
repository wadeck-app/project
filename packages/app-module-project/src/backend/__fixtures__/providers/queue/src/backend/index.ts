import type { ModuleContext } from '@wadeck-app/app-core-sdk';

/** Fixture of the queue: GET /project-scope?id=<id>&name=<name> answers the projectScope of the real events page. */
export default function (ctx: ModuleContext): void {
  // A provider that sends no moreUrl: the Related table must show no "See all" link for it.
  ctx.registerRoute('GET', '/related/project/:projectId', async (req, reply) => {
    const projectId = (req as unknown as { params: { projectId: string } }).params.projectId;
    const out = reply as unknown as { code(status: number): { send(body: unknown): unknown } };
    return out.code(200).send({ title: 'Fixture events', items: [{ label: `Event of ${projectId}`, url: `/modules/queue/events?id=${projectId}` }] });
  });

  ctx.registerRoute('GET', '/project-scope', async (req, reply) => {
    const query = (req as unknown as { query: Record<string, string | undefined> }).query;
    const id = query['id'] ?? '';
    const out = reply as unknown as { code(status: number): { send(body: unknown): unknown } };
    return out.code(200).send({ id, name: query['name'] ?? '', found: id !== '' });
  });
}
