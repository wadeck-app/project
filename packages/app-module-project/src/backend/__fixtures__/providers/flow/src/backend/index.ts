import type { ModuleContext } from '@wadeck-app/app-core-sdk';

/**
 * Fixture of flow: GET /executions/:id. An id "ex-<projectId>" is an execution of that project (label "Fixture project"); any other id is an
 * old execution, which has neither projectId nor projectLabel.
 */
export default function (ctx: ModuleContext): void {
  ctx.registerRoute('GET', '/executions/:id', async (req, reply) => {
    const id = (req as unknown as { params: { id: string } }).params.id;
    const out = reply as unknown as { code(status: number): { send(body: unknown): unknown } };
    const match = /^ex-([0-9a-f]{8})$/.exec(id);
    return out.code(200).send(match === null ? { id } : { id, projectId: match[1], projectLabel: 'Fixture project' });
  });
}
