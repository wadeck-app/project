import { ProjectNotFoundError } from '@wadeck-app/project-sdk';
import { describe, expect, it } from 'vitest';
import { RequestError } from './httpError.js';
import { createRouteKit } from './routeKit.js';

interface Sent {
  status: number;
  body: unknown;
}

/** Registers one route with a fake context and runs its handler. */
async function run(
  handler: () => Promise<{ status: number; body: unknown }>,
  query: Record<string, unknown> = {},
): Promise<{ sent: Sent; stderr: string[] }> {
  const stderr: string[] = [];
  let registered: ((req: unknown, reply: unknown) => Promise<unknown>) | undefined;
  const ctx = { registerRoute: (_m: string, _p: string, h: typeof registered) => (registered = h) };
  createRouteKit(ctx as never, (text) => stderr.push(text)).route('GET', '/x', handler);
  const sent: Sent = { status: 0, body: undefined };
  const reply = {
    code(status: number) {
      sent.status = status;
      return { send: (body: unknown) => (sent.body = body) };
    },
  };
  await registered!({ query }, reply);
  return { sent, stderr };
}

describe('createRouteKit', () => {
  it('sends the status and the body of the answer', async () => {
    const { sent } = await run(async () => ({ status: 201, body: { id: 'a' } }));
    expect(sent).toEqual({ status: 201, body: { id: 'a' } });
  });

  it('turns an error into its HTTP answer, without a trace on stderr for a mistake of the caller', async () => {
    const { sent, stderr } = await run(async () => {
      throw new ProjectNotFoundError('nope', { ref: 'nope', suggestions: [] });
    });
    expect(sent.status).toBe(404);
    expect(sent.body).toMatchObject({ error: 'PROJECT_NOT_FOUND' });
    expect(stderr).toEqual([]);
  });

  it('reports an unexpected failure (5xx) on stderr, so that it is not silent', async () => {
    const { sent, stderr } = await run(async () => {
      throw new Error('boom');
    });
    expect(sent.status).toBe(500);
    expect(stderr.join('')).toContain('boom');
  });

  it('with ?inlineErrors=true a failure is answered 200 with the text to display, so that the page does not go blank', async () => {
    const { sent } = await run(
      async () => {
        throw new RequestError(400, 'bad thing', 'do this');
      },
      { inlineErrors: 'true' },
    );
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ failed: true, httpStatus: 400, errorText: 'bad thing. do this' });
  });
});
