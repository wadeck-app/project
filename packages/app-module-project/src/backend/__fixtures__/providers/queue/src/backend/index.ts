import type { ModuleContext } from '@wadeck-app/app-core-sdk';

/** Fixture of the queue: GET /project-scope?id=<id>&name=<name> answers the projectScope of the real events page. */
export default function (ctx: ModuleContext): void {
  ctx.registerRoute('GET', '/project-scope', async (req, reply) => {
    const query = (req as unknown as { query: Record<string, string | undefined> }).query;
    const id = query['id'] ?? '';
    const out = reply as unknown as { code(status: number): { send(body: unknown): unknown } };
    return out.code(200).send({ id, name: query['name'] ?? '', found: id !== '' });
  });
}
